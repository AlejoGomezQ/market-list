-- D-049/D-050/D-052: copy_catalog reproduce el catálogo de un hogar en otro (multi-hogar, D-043).
--
-- Excepción acotada a D-039 ("un solo camino de escritura"): es administrativa, en línea, no
-- frecuente, y debe ser atómica (100+ filas a medio copiar es peor que no copiar). Mismo precedente
-- que la siembra de 7 categorías de create_household: INSERT server-side con gen_random_uuid()
-- EXPLÍCITO (D-024 prohíbe el default, no el id explícito), fuera de la cola de sync_push.
--
-- Copia productos + sus categorías + sus supermercados, con ids nuevos, remapeando category_id y
-- supermarket_id. NO copia list_items (son de la ocasión), NO copia lápidas, NO escribe updated_at
-- (lo pone el default now() del servidor en el INSERT; el trigger set_updated_at solo actúa en
-- UPDATE). El resultado lo recogen los dispositivos del hogar destino por su delta pull normal.
--
-- Realtime: nada que hacer. supermarkets/categories/products ya están en la publicación
-- supabase_realtime como tabla entera (20260906183416_realtime_publication.sql); las filas nuevas
-- se emiten solas. copy_catalog y list_households no son tablas, no tocan la publicación.
--
-- Duplicados (D-050): supermercados y categorías se emparejan con los del destino por
-- lower(btrim(name)); los que ya existen se reutilizan. Un hogar recién creado trae las 7
-- categorías de RF-020, así que "Lácteos" del origen se empareja en vez de duplicarse. Un producto
-- cuyo (lower(name), lower(brand)) ya exista activo en el destino se omite (resuelve D-006 en masa).
--
-- Color de los supermercados (D-052): no hay columna de color -- el color se deriva del orden
-- `position` en el cliente (identidad_visual §2). "Siguiente color libre" = append por position al
-- final de los del destino. Idéntico para el orden de categorías.
--
-- Propiedad: ejecutar copy_catalog dos veces seguidas es un no-op ({0,0,0}).

create or replace function copy_catalog(
  p_source_household uuid,
  p_target_household uuid,
  p_copy_supermarkets boolean default true,
  p_copy_categories   boolean default true
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := now();
  v_sm   int := 0;
  v_cat  int := 0;
  v_prod int := 0;
  v_pos  int;
  v_new_id uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'copy_catalog: se requiere sesión autenticada';
  end if;
  if not is_member(p_source_household) then
    raise exception 'copy_catalog: no eres miembro del hogar de origen';
  end if;
  if not is_member(p_target_household) then
    raise exception 'copy_catalog: no eres miembro del hogar de destino';
  end if;
  if p_source_household = p_target_household then
    raise exception 'copy_catalog: origen y destino son el mismo hogar';
  end if;

  -- ---- Mapa de supermercados: empareja por nombre normalizado con los activos del destino -------
  create temp table _sm (src uuid primary key, tgt uuid) on commit drop;
  insert into _sm (src, tgt)
    select s.id,
           (select t.id
              from supermarkets t
              where t.household_id = p_target_household
                and t.deleted_at is null
                and lower(btrim(t.name)) = lower(btrim(s.name))
              order by t.position
              limit 1)
    from supermarkets s
    where s.household_id = p_source_household and s.deleted_at is null;

  if p_copy_supermarkets then
    v_pos := coalesce(
      (select max(position) from supermarkets
        where household_id = p_target_household and deleted_at is null), -1);
    for r in
      select m.src, s.name
      from _sm m
      join supermarkets s on s.id = m.src
      where m.tgt is null
      order by s.position, s.name
    loop
      v_pos := v_pos + 1;
      v_new_id := gen_random_uuid();
      insert into supermarkets (id, household_id, name, position, field_updated_at)
        values (v_new_id, p_target_household, r.name, v_pos,
                jsonb_build_object('name', to_jsonb(v_now), 'position', to_jsonb(v_now)));
      update _sm set tgt = v_new_id where src = r.src;
      v_sm := v_sm + 1;
    end loop;
  end if;

  -- ---- Mapa de categorías: idéntico patrón --------------------------------------------------------
  create temp table _cat (src uuid primary key, tgt uuid) on commit drop;
  insert into _cat (src, tgt)
    select c.id,
           (select t.id
              from categories t
              where t.household_id = p_target_household
                and t.deleted_at is null
                and lower(btrim(t.name)) = lower(btrim(c.name))
              order by t.position
              limit 1)
    from categories c
    where c.household_id = p_source_household and c.deleted_at is null;

  if p_copy_categories then
    v_pos := coalesce(
      (select max(position) from categories
        where household_id = p_target_household and deleted_at is null), -1);
    for r in
      select m.src, c.name
      from _cat m
      join categories c on c.id = m.src
      where m.tgt is null
      order by c.position, c.name
    loop
      v_pos := v_pos + 1;
      v_new_id := gen_random_uuid();
      insert into categories (id, household_id, name, position, field_updated_at)
        values (v_new_id, p_target_household, r.name, v_pos,
                jsonb_build_object('name', to_jsonb(v_now), 'position', to_jsonb(v_now)));
      update _cat set tgt = v_new_id where src = r.src;
      v_cat := v_cat + 1;
    end loop;
  end if;

  -- ---- Productos: uno por fila activa del origen que no exista ya activa en el destino -----------
  insert into products (id, household_id, name, brand, category_id, supermarket_id, field_updated_at)
    select gen_random_uuid(), p_target_household, p.name, p.brand,
           case when p_copy_categories   then (select tgt from _cat where src = p.category_id)    end,
           case when p_copy_supermarkets then (select tgt from _sm  where src = p.supermarket_id) end,
           jsonb_build_object('name', to_jsonb(v_now), 'brand', to_jsonb(v_now),
                              'category_id', to_jsonb(v_now), 'supermarket_id', to_jsonb(v_now))
    from products p
    where p.household_id = p_source_household and p.deleted_at is null
      and not exists (
        select 1 from products d
        where d.household_id = p_target_household and d.deleted_at is null
          and lower(btrim(d.name)) = lower(btrim(p.name))
          and coalesce(lower(btrim(d.brand)), '') = coalesce(lower(btrim(p.brand)), '')
      );
  get diagnostics v_prod = row_count;

  return jsonb_build_object(
    'supermarkets_created', v_sm,
    'categories_created', v_cat,
    'products_copied', v_prod
  );
end;
$$;

comment on function copy_catalog(uuid, uuid, boolean, boolean) is
  'Copia productos + categorías + supermercados de un hogar a otro con ids nuevos (D-049/D-050/D-052). Atómica, idempotente, exige is_member sobre ambos hogares. No copia list_items ni lápidas.';

revoke execute on function copy_catalog(uuid, uuid, boolean, boolean) from public;
grant execute on function copy_catalog(uuid, uuid, boolean, boolean) to authenticated;
