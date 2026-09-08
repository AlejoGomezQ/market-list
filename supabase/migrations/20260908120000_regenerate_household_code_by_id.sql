-- D-048: regenerate_household_code pasa a recibir p_household_id explícito en vez de derivar el
-- hogar de la propia membresía del llamador (que con multi-hogar, D-043, es ambigua: un dispositivo
-- pertenece a varios). Sustituye a 20260906193000_regenerate_household_code.sql.
--
-- La firma cambia, así que no basta `create or replace`: se elimina la versión sin parámetros y se
-- crea la nueva. La validación "solo un miembro puede invocarla" deja de ser una propiedad de la
-- firma (ya no hay `limit 1` sobre la membresía) y pasa a ser una comprobación explícita de
-- is_member(p_household_id), igual que sync_push valida cada parche (arquitectura §5).
--
-- Mantiene D-040 acotado al hogar indicado: regenerar el código expulsa a los demás miembros de ESE
-- hogar, nunca de otros a los que el llamador también pertenezca.

drop function if exists regenerate_household_code();

create or replace function regenerate_household_code(p_household_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_code text;
begin
  if v_user_id is null then
    raise exception 'regenerate_household_code: se requiere sesión autenticada';
  end if;
  if not is_member(p_household_id) then
    raise exception 'regenerate_household_code: no eres miembro de ese hogar';
  end if;

  v_new_code := household_generate_join_code();

  update households
    set join_code = v_new_code, updated_at = now()
    where id = p_household_id;

  -- D-040: solo sobrevive la membresía de quien ejecuta la acción, y solo en este hogar.
  delete from household_members
    where household_id = p_household_id and user_id <> v_user_id;

  return jsonb_build_object('household_id', p_household_id, 'join_code', v_new_code);
end;
$$;

comment on function regenerate_household_code(uuid) is
  'Regenera el código de p_household_id y expulsa a los demás miembros de ese hogar (D-040/D-048). Valida is_member.';

revoke execute on function regenerate_household_code(uuid) from public;
grant execute on function regenerate_household_code(uuid) to authenticated;
