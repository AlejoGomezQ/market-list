-- Historial de compras (backlog_v2 §5 y §6, CAMINO A): derivado de las lápidas de list_items con
-- removed_reason='purchased' (D-026 ya diseñó el esquema para esto). No hay tabla `purchases`: se
-- añaden dos columnas nullable a list_items y el total se denormaliza repetido en cada item del
-- lote.
--
--   purchase_batch_id  uuid    -- agrupa los items finalizados en un mismo gesto ("una compra").
--                                 Se genera en el cliente al finalizar (D-024).
--   purchase_total     numeric -- total gastado opcional en esa compra (backlog §6), repetido en
--                                 cada item del lote.
--
-- Ambas nullable y sin default -> ALTER instantáneo, sin reescritura de tabla. Pasan por la fusión
-- LWW genérica de sync_apply_list_item_patch como cualquier otro campo (D-025). RLS y la
-- publicación de realtime no necesitan nada: las políticas filtran por fila, no por columna, y
-- realtime manda la fila entera. El trigger set_updated_at ya cubre cualquier columna nueva.

alter table list_items
  add column purchase_batch_id uuid,
  add column purchase_total numeric check (purchase_total is null or purchase_total >= 0);

comment on column list_items.purchase_batch_id is
  'Historial V2 (CAMINO A): agrupa los items finalizados en un mismo gesto. uuid del cliente (D-024). null mientras el item no se ha comprado; buildUndoFinalize lo devuelve a null.';
comment on column list_items.purchase_total is
  'Historial V2 (backlog §6): total gastado opcional de la compra, denormalizado repetido en cada item del lote. null si no se registró.';

-- sync_apply_list_item_patch recreada: mismo cuerpo que en 20260906190000_sync_push.sql, con
-- purchase_batch_id y purchase_total añadidos al UPDATE de la fila existente. El bump de
-- field_updated_at es genérico (sync_lww_bump_field_updated_at sobre las claves de v_applied), así
-- que los campos nuevos ya entran solos. El INSERT no se toca: finalizar siempre actúa sobre una
-- fila existente. La regla C-001/C-006 (item retirado ignora parches de checked) no se toca.

create or replace function sync_apply_list_item_patch(p_id uuid, p_ts timestamptz, p_fields jsonb)
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
      purchase_batch_id = case when v_applied ? 'purchase_batch_id' then (v_applied ->> 'purchase_batch_id')::uuid else purchase_batch_id end,
      purchase_total = case when v_applied ? 'purchase_total' then (v_applied ->> 'purchase_total')::numeric else purchase_total end,
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
  'Alta o fusión LWW de un patch sobre list_items, indexado por product_id en la alta (C-005) y con removed_at no absorbente (D-032). purchase_batch_id/purchase_total (historial V2) se funden como cualquier otro campo.';

-- sync_push es la única puerta (D-039): create or replace conserva el grant, pero revoke explícito
-- por si acaso, igual que la migración original.
revoke execute on function sync_apply_list_item_patch(uuid, timestamptz, jsonb) from public;
