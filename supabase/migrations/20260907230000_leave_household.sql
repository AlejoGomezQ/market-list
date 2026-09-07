-- leave_household (D-014): un dispositivo abandona su hogar por decisión propia. Borra su membresía
-- en el servidor; el cliente borra además todos los datos locales (la caché de TanStack Query en
-- IndexedDB y el vínculo en localStorage). Para volver a entrar hace falta el código del hogar --
-- salir deja el dispositivo en el mismo estado que tras reinstalar, y D-014 fija que el código es
-- la única vía de recuperación.
--
-- Sin parámetros: el hogar se deriva de la propia membresía del llamador, no de un household_id que
-- el cliente pudiera falsificar -- "solo el propio miembro puede salir" es una propiedad de la
-- firma, no una comprobación aparte (mismo criterio que regenerate_household_code).
--
-- security definer por el mismo motivo que regenerate_household_code (arquitectura §5): la política
-- de household_members no concede delete (D-039 solo cubre las cuatro tablas sincronizadas vía
-- sync_push). Borrado físico, igual que la expulsión de regenerate_household_code: household_members
-- no es una de las cuatro tablas sincronizadas (arquitectura §2.1), así que no lleva lápida --
-- "salir" significa exactamente que is_member() deje de ser cierto para este usuario en el
-- siguiente intento de sincronizar.

create function leave_household()
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

  -- Borra TODAS las membresías del llamador (en la práctica una: un dispositivo pertenece a un solo
  -- hogar, household-link.ts). No hace falta acotar por household_id.
  delete from household_members where user_id = v_user_id;

  return jsonb_build_object('left', true);
end;
$$;

comment on function leave_household() is
  'Borra la membresía del dispositivo llamador: sale del hogar (D-014). Para volver a entrar hace falta el código.';

grant execute on function leave_household() to authenticated;
