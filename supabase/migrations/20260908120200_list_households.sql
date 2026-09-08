-- D-053: list_households() es la fuente de verdad del selector de hogar (multi-hogar, D-043).
-- Devuelve las membresías del llamador ordenadas por joined_at para que el selector de Ajustes
-- pueda mostrar la verdad y podar hogares de los que te expulsaron (D-040/D-048) o que ya no
-- existen. El vínculo local sigue bastando para el camino feliz y para arrancar sin red.
--
-- security definer como is_member/create_household (arquitectura §5), pero solo devuelve filas de
-- auth.uid(): un llamador nunca ve membresías ajenas.

create or replace function list_households()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('household_id', h.id, 'name', h.name, 'join_code', h.join_code)
      order by m.joined_at
    ),
    '[]'::jsonb
  )
  from household_members m
  join households h on h.id = m.household_id
  where m.user_id = auth.uid();
$$;

comment on function list_households() is
  'Membresías del llamador para el selector de hogar (D-053). Ordenadas por joined_at. Solo filas de auth.uid().';

revoke execute on function list_households() from public;
grant execute on function list_households() to authenticated;
