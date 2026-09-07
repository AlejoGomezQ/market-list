-- regenerate_household_code (D-014, D-040): genera un código nuevo para el hogar del llamador y
-- expulsa a los demás dispositivos.
--
-- Mecanismo, literal de decisiones_cerradas_v0.1.md #D-040: "Regenerar el código del hogar elimina
-- también las membresías distintas de la que ejecuta la acción, y obliga al otro dispositivo a
-- volver a entrar con el código nuevo". Es borrado físico de household_members, no una lápida: esa
-- tabla no es una de las cuatro sincronizadas (arquitectura §2.1) y "expulsar" significa
-- exactamente que is_member() deje de ser cierto para ese usuario en el siguiente intento de
-- sincronizar. Sin parámetros: el hogar del llamador se deriva de su propia membresía, no de un
-- household_id que el cliente pudiera falsificar -- así "solo el propio miembro puede invocarla"
-- es una propiedad de la firma de la función, no una comprobación aparte.
--
-- security definer por el mismo motivo que create_household/join_household (arquitectura §5): la
-- política de households no concede update y la de household_members no concede delete (D-039 solo
-- cubre las cuatro tablas sincronizadas vía sync_push; households/household_members se escriben
-- desde estas funciones propias).

create function regenerate_household_code()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_new_code text;
begin
  if v_user_id is null then
    raise exception 'regenerate_household_code: se requiere sesión autenticada';
  end if;

  select household_id into v_household_id
    from household_members
    where user_id = v_user_id
    limit 1;

  if v_household_id is null then
    raise exception 'regenerate_household_code: el usuario no pertenece a ningún hogar';
  end if;

  v_new_code := household_generate_join_code();

  update households
    set join_code = v_new_code, updated_at = now()
    where id = v_household_id;

  -- La expulsión: solo sobrevive la membresía de quien ejecuta la acción.
  delete from household_members
    where household_id = v_household_id and user_id <> v_user_id;

  return jsonb_build_object('household_id', v_household_id, 'join_code', v_new_code);
end;
$$;

comment on function regenerate_household_code() is
  'Regenera el código del hogar del llamador y borra la membresía de los demás dispositivos (D-040).';

grant execute on function regenerate_household_code() to authenticated;
