-- sync_push: la única vía de escritura real sobre las cuatro tablas sincronizadas (D-039).
--
-- Recibe un lote de parches `{entity, id, ts, fields}` (arquitectura §4) y los aplica de forma
-- atómica -- toda la función es una sola transacción -- con fusión campo a campo comparando
-- field_updated_at (último en escribir gana, D-017/D-025). Es security definer porque RLS no
-- concede insert/update directos (D-039): esta función es la costura única.
--
-- Aislamiento (arquitectura §5): cada patch se valida contra is_member() usando el household_id
-- de la fila (existente, o el que trae el propio patch en una alta). Si el llamador no pertenece a
-- ese hogar, la función lanza una excepción y aborta el lote entero. No es "ignorar en silencio":
-- la estrategia de sincronización (docs/estrategia_sincronizacion_v0.1.md §5.1) clasifica "RLS
-- deniega" como error PERMANENTE -> cuarentena, y el lote ya se procesa de forma atómica (§4.3 de
-- la arquitectura), así que abortarlo entero ante un patch no autorizado es la lectura literal de
-- esa tabla de errores, no una decisión nueva. Un lote legítimo nunca mezcla hogares -- la sesión
-- del cliente pertenece a uno solo -- así que en la práctica esto solo dispara ante un bug propio
-- o un intento de escritura ajena, y ambos casos piden ruido, no silencio.

-- ---------------------------------------------------------------------------------------------
-- Helpers de fusión campo a campo (D-017/D-025). No son security definer: se ejecutan dentro de
-- sync_push, que ya cambia el rol efectivo para toda la llamada, incluidas las funciones anidadas.
-- Se revoca su ejecución directa más abajo para que sync_push siga siendo la única puerta (D-039).
-- ---------------------------------------------------------------------------------------------

create function sync_lww_applied_fields(p_existing jsonb, p_incoming jsonb, p_ts timestamptz)
  returns jsonb
  language sql
  immutable
  set search_path = public
as $$
  -- Para cada campo del parche: se aplica solo si no hay marca previa o el parche es más nuevo
  -- (estrictamente mayor: un empate de timestamp, como el de un reenvío idéntico, no se reaplica,
  -- que es justamente lo que hace idempotente a D-025).
  select coalesce(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
  from jsonb_each(p_incoming) as kv(key, value)
  where p_existing ->> kv.key is null
     or (p_existing ->> kv.key)::timestamptz < p_ts;
$$;

comment on function sync_lww_applied_fields(jsonb, jsonb, timestamptz) is
  'Subconjunto de p_incoming cuyos campos ganan la comparación LWW contra field_updated_at (D-017/D-025).';

create function sync_lww_bump_field_updated_at(p_existing jsonb, p_applied jsonb, p_ts timestamptz)
  returns jsonb
  language sql
  immutable
  set search_path = public
as $$
  select p_existing || coalesce(
    (select jsonb_object_agg(key, to_jsonb(p_ts)) from jsonb_object_keys(p_applied) as key),
    '{}'::jsonb
  );
$$;

comment on function sync_lww_bump_field_updated_at(jsonb, jsonb, timestamptz) is
  'field_updated_at resultante tras aplicar p_applied: cada campo aplicado queda marcado con p_ts.';

-- ---------------------------------------------------------------------------------------------
-- supermarkets / categories / products: mismas cuatro columnas comunes + su propio puñado de
-- campos de dominio. deleted_at es lápida ABSORBENTE (arquitectura §4.1): ningún parche posterior
-- la resucita, así que una fila ya borrada descarta el patch entero antes de mirar field_updated_at.
-- ---------------------------------------------------------------------------------------------

create function sync_apply_catalog_patch(p_entity text, p_id uuid, p_ts timestamptz, p_fields jsonb)
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  v_household_id   uuid;
  v_deleted_at     timestamptz;
  v_field_updated_at jsonb;
  v_incoming       jsonb := p_fields - 'id' - 'household_id';
  v_applied        jsonb;
  v_new_field_updated_at jsonb;
begin
  if p_entity = 'supermarkets' then
    select household_id, deleted_at, field_updated_at into v_household_id, v_deleted_at, v_field_updated_at
      from supermarkets where id = p_id for update;
  elsif p_entity = 'categories' then
    select household_id, deleted_at, field_updated_at into v_household_id, v_deleted_at, v_field_updated_at
      from categories where id = p_id for update;
  elsif p_entity = 'products' then
    select household_id, deleted_at, field_updated_at into v_household_id, v_deleted_at, v_field_updated_at
      from products where id = p_id for update;
  else
    raise exception 'sync_push: entidad desconocida %', p_entity;
  end if;

  if not found then
    -- Alta (D-024: id generado en el cliente). household_id viene en el propio patch.
    v_household_id := (p_fields ->> 'household_id')::uuid;
    if v_household_id is null then
      raise exception 'sync_push: % requiere household_id para dar de alta %', p_entity, p_id;
    end if;
    if not is_member(v_household_id) then
      raise exception 'sync_push: hogar % no autorizado', v_household_id;
    end if;

    v_new_field_updated_at := sync_lww_bump_field_updated_at('{}'::jsonb, v_incoming, p_ts);

    if p_entity = 'supermarkets' then
      insert into supermarkets (id, household_id, name, position, field_updated_at)
        values (p_id, v_household_id, v_incoming ->> 'name',
                coalesce((v_incoming ->> 'position')::int, 0), v_new_field_updated_at);
    elsif p_entity = 'categories' then
      insert into categories (id, household_id, name, position, field_updated_at)
        values (p_id, v_household_id, v_incoming ->> 'name',
                coalesce((v_incoming ->> 'position')::int, 0), v_new_field_updated_at);
    elsif p_entity = 'products' then
      insert into products (id, household_id, name, brand, category_id, supermarket_id, field_updated_at)
        values (p_id, v_household_id, v_incoming ->> 'name', v_incoming ->> 'brand',
                (v_incoming ->> 'category_id')::uuid, (v_incoming ->> 'supermarket_id')::uuid,
                v_new_field_updated_at);
    end if;

    return 'inserted';
  end if;

  -- Fila existente: aislamiento primero (arquitectura §5).
  if not is_member(v_household_id) then
    raise exception 'sync_push: hogar % no autorizado', v_household_id;
  end if;

  -- Lápida absorbente (arquitectura §4.1): ningún parche revive una fila borrada.
  if v_deleted_at is not null then
    return 'ignored_tombstoned';
  end if;

  v_applied := sync_lww_applied_fields(v_field_updated_at, v_incoming, p_ts);
  if v_applied = '{}'::jsonb then
    return 'ignored_stale';
  end if;
  v_new_field_updated_at := sync_lww_bump_field_updated_at(v_field_updated_at, v_applied, p_ts);

  if p_entity = 'supermarkets' then
    update supermarkets set
      name = coalesce(v_applied ->> 'name', name),
      position = case when v_applied ? 'position' then (v_applied ->> 'position')::int else position end,
      deleted_at = case when v_applied ? 'deleted_at' then (v_applied ->> 'deleted_at')::timestamptz else deleted_at end,
      field_updated_at = v_new_field_updated_at
    where id = p_id;
  elsif p_entity = 'categories' then
    update categories set
      name = coalesce(v_applied ->> 'name', name),
      position = case when v_applied ? 'position' then (v_applied ->> 'position')::int else position end,
      deleted_at = case when v_applied ? 'deleted_at' then (v_applied ->> 'deleted_at')::timestamptz else deleted_at end,
      field_updated_at = v_new_field_updated_at
    where id = p_id;
  elsif p_entity = 'products' then
    update products set
      name = coalesce(v_applied ->> 'name', name),
      brand = case when v_applied ? 'brand' then v_applied ->> 'brand' else brand end,
      category_id = case when v_applied ? 'category_id' then (v_applied ->> 'category_id')::uuid else category_id end,
      supermarket_id = case when v_applied ? 'supermarket_id' then (v_applied ->> 'supermarket_id')::uuid else supermarket_id end,
      deleted_at = case when v_applied ? 'deleted_at' then (v_applied ->> 'deleted_at')::timestamptz else deleted_at end,
      field_updated_at = v_new_field_updated_at
    where id = p_id;
  end if;

  return 'applied';
end;
$$;

comment on function sync_apply_catalog_patch(text, uuid, timestamptz, jsonb) is
  'Alta o fusión LWW de un patch sobre supermarkets/categories/products, con deleted_at como lápida absorbente (arquitectura §4.1, §4.2).';

-- ---------------------------------------------------------------------------------------------
-- list_items: removed_at NO es absorbente (arquitectura §4.1) -- es un campo normal sujeto a LWW,
-- lo que permite D-032 (deshacer finalización). La alta se funde por product_id, no por id
-- (C-005): el índice único parcial garantiza como mucho un activo por producto.
-- ---------------------------------------------------------------------------------------------

create function sync_merge_into_active_list_item(p_product_id uuid, p_ts timestamptz, p_incoming jsonb)
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  v_id uuid;
  v_field_updated_at jsonb;
  v_applied jsonb;
  v_new_field_updated_at jsonb;
begin
  select id, field_updated_at into v_id, v_field_updated_at
    from list_items where product_id = p_product_id and removed_at is null
    for update;

  if not found then
    return null; -- no hay activo que fundir; el llamador decide (insertar, o reintentar tras choque).
  end if;

  v_applied := sync_lww_applied_fields(v_field_updated_at, p_incoming - 'product_id', p_ts);
  if v_applied = '{}'::jsonb then
    return 'ignored_stale';
  end if;
  v_new_field_updated_at := sync_lww_bump_field_updated_at(v_field_updated_at, v_applied, p_ts);

  update list_items set
    quantity = case when v_applied ? 'quantity' then (v_applied ->> 'quantity')::int else quantity end,
    checked = case when v_applied ? 'checked' then (v_applied ->> 'checked')::boolean else checked end,
    checked_at = case when v_applied ? 'checked_at' then (v_applied ->> 'checked_at')::timestamptz else checked_at end,
    field_updated_at = v_new_field_updated_at
  where id = v_id;

  return 'merged_existing_active';
end;
$$;

comment on function sync_merge_into_active_list_item(uuid, timestamptz, jsonb) is
  'C-005: funde una intención de alta en el item activo ya existente para ese product_id, en vez de insertar una segunda fila.';

create function sync_apply_list_item_patch(p_id uuid, p_ts timestamptz, p_fields jsonb)
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  v_household_id uuid;
  v_removed_at timestamptz;
  v_field_updated_at jsonb;
  v_product_id uuid;
  v_incoming jsonb := p_fields - 'id' - 'household_id';
  v_applied jsonb;
  v_new_field_updated_at jsonb;
  v_product_deleted_at timestamptz;
  v_status text;
begin
  select household_id, removed_at, field_updated_at into v_household_id, v_removed_at, v_field_updated_at
    from list_items where id = p_id for update;

  if found then
    if not is_member(v_household_id) then
      raise exception 'sync_push: hogar % no autorizado', v_household_id;
    end if;

    -- C-001/C-006: quitar (o finalizar) gana sobre marcar. Un item ya retirado descarta cualquier
    -- parche que solo toque checked/checked_at; removed_at sigue LWW normal, lo que permite D-032.
    if v_removed_at is not null then
      v_incoming := v_incoming - 'checked' - 'checked_at';
    end if;

    v_applied := sync_lww_applied_fields(v_field_updated_at, v_incoming, p_ts);
    if v_applied = '{}'::jsonb then
      return 'ignored_stale';
    end if;
    v_new_field_updated_at := sync_lww_bump_field_updated_at(v_field_updated_at, v_applied, p_ts);

    update list_items set
      quantity = case when v_applied ? 'quantity' then (v_applied ->> 'quantity')::int else quantity end,
      checked = case when v_applied ? 'checked' then (v_applied ->> 'checked')::boolean else checked end,
      checked_at = case when v_applied ? 'checked_at' then (v_applied ->> 'checked_at')::timestamptz else checked_at end,
      removed_at = case when v_applied ? 'removed_at' then (v_applied ->> 'removed_at')::timestamptz else removed_at end,
      removed_reason = case when v_applied ? 'removed_reason' then v_applied ->> 'removed_reason' else removed_reason end,
      field_updated_at = v_new_field_updated_at
    where id = p_id;

    return 'applied';
  end if;

  -- No existe fila con este id: es una alta (RF-009, "agregar a la lista" es una intención).
  v_household_id := (p_fields ->> 'household_id')::uuid;
  v_product_id := (v_incoming ->> 'product_id')::uuid;

  if v_household_id is null then
    raise exception 'sync_push: list_items requiere household_id para dar de alta %', p_id;
  end if;
  if not is_member(v_household_id) then
    raise exception 'sync_push: hogar % no autorizado', v_household_id;
  end if;
  if v_product_id is null then
    raise exception 'sync_push: list_items requiere product_id para dar de alta %', p_id;
  end if;

  -- arquitectura §4.3: insertar contra un padre borrado se descarta, no revive al producto.
  select deleted_at into v_product_deleted_at from products where id = v_product_id;
  if v_product_deleted_at is not null then
    return 'ignored_deleted_product';
  end if;

  v_status := sync_merge_into_active_list_item(v_product_id, p_ts, v_incoming);
  if v_status is not null then
    return v_status;
  end if;

  begin
    v_new_field_updated_at := sync_lww_bump_field_updated_at('{}'::jsonb, v_incoming - 'product_id', p_ts);
    insert into list_items (id, household_id, product_id, quantity, checked, checked_at, field_updated_at)
      values (p_id, v_household_id, v_product_id,
              coalesce((v_incoming ->> 'quantity')::int, 1),
              coalesce((v_incoming ->> 'checked')::boolean, false),
              (v_incoming ->> 'checked_at')::timestamptz,
              v_new_field_updated_at);
    return 'inserted';
  exception when unique_violation then
    -- C-005 con "casi a la vez" literal: dos sync_push concurrentes no se vieron el uno al otro
    -- antes del insert. Se relee y se funde en vez de dejar que el choque suba a cuarentena.
    v_status := sync_merge_into_active_list_item(v_product_id, p_ts, v_incoming);
    if v_status is not null then
      return v_status;
    end if;
    raise;
  end;
end;
$$;

comment on function sync_apply_list_item_patch(uuid, timestamptz, jsonb) is
  'Alta o fusión LWW de un patch sobre list_items, indexado por product_id en la alta (C-005) y con removed_at no absorbente (D-032).';

-- ---------------------------------------------------------------------------------------------
-- sync_push: el driver del lote.
-- ---------------------------------------------------------------------------------------------

create function sync_push(p_patches jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_patch jsonb;
  v_entity text;
  v_id uuid;
  v_ts timestamptz;
  v_fields jsonb;
  v_status text;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'sync_push: se requiere sesión autenticada';
  end if;

  if p_patches is null or jsonb_typeof(p_patches) <> 'array' then
    raise exception 'sync_push: p_patches debe ser un array jsonb';
  end if;

  for v_patch in select * from jsonb_array_elements(p_patches)
  loop
    v_entity := v_patch ->> 'entity';
    v_id := (v_patch ->> 'id')::uuid;
    v_fields := coalesce(v_patch -> 'fields', '{}'::jsonb);

    if v_id is null then
      raise exception 'sync_push: parche sin id válido (%)', v_patch;
    end if;

    -- D-025: la marca del cliente se acota al now() del servidor. Un reloj adelantado no debe
    -- ganar siempre, y updated_at (el cursor, columna aparte) lo pone el trigger, nunca esto.
    v_ts := least((v_patch ->> 'ts')::timestamptz, v_now);

    if v_entity in ('supermarkets', 'categories', 'products') then
      v_status := sync_apply_catalog_patch(v_entity, v_id, v_ts, v_fields);
    elsif v_entity = 'list_items' then
      v_status := sync_apply_list_item_patch(v_id, v_ts, v_fields);
    else
      raise exception 'sync_push: entidad desconocida %', v_entity;
    end if;

    v_results := v_results || jsonb_build_object('entity', v_entity, 'id', v_id, 'status', v_status);
  end loop;

  return v_results;
end;
$$;

comment on function sync_push(jsonb) is
  'Única vía de escritura sobre las cuatro tablas sincronizadas (D-039). Lote atómico de parches {entity, id, ts, fields}; ver arquitectura §4. Un patch de un hogar ajeno aborta el lote entero (ver comentario de cabecera del archivo).';

-- D-039: sync_push es la única puerta. Los helpers no se exponen como un segundo camino de
-- escritura ni como RPC aparte -- PostgREST expone por defecto toda función del esquema public.
revoke execute on function sync_lww_applied_fields(jsonb, jsonb, timestamptz) from public;
revoke execute on function sync_lww_bump_field_updated_at(jsonb, jsonb, timestamptz) from public;
revoke execute on function sync_apply_catalog_patch(text, uuid, timestamptz, jsonb) from public;
revoke execute on function sync_merge_into_active_list_item(uuid, timestamptz, jsonb) from public;
revoke execute on function sync_apply_list_item_patch(uuid, timestamptz, jsonb) from public;

grant execute on function sync_push(jsonb) to authenticated;
