-- D-048: leave_household pasa a recibir p_household_id explícito. Sustituye a
-- 20260907230000_leave_household.sql, que borraba TODAS las membresías del llamador (correcto
-- cuando un dispositivo pertenecía a un solo hogar; con multi-hogar, D-043, hay que salir solo del
-- indicado).
--
-- La firma cambia: se elimina la versión sin parámetros y se crea la nueva. Sigue sin validar
-- is_member por adelantado -- el `delete ... where user_id = auth.uid()` ya acota a la propia
-- membresía y es idempotente: salir de un hogar del que no eres miembro no borra nada ni lanza.

drop function if exists leave_household();

create or replace function leave_household(p_household_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'leave_household: se requiere sesión autenticada';
  end if;

  delete from household_members
    where household_id = p_household_id and user_id = v_user_id;

  return jsonb_build_object('left', true);
end;
$$;

comment on function leave_household(uuid) is
  'Borra solo la membresía del llamador en p_household_id (D-048). Idempotente.';

revoke execute on function leave_household(uuid) from public;
grant execute on function leave_household(uuid) to authenticated;
