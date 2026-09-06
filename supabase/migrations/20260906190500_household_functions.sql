-- create_household / join_household (RF-022, D-014). Ambas son security definer: quien crea
-- todavía no tiene fila en household_members, y quien se une tampoco, así que ninguna de las dos
-- podría ver ni escribir la fila de households si dependiera de las políticas RLS normales
-- (arquitectura §5).

create function household_generate_join_code()
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  -- D-014/arquitectura §5: ocho caracteres sin ambigüedades visuales -- se excluyen O/0 e I/1 del
  -- alfabeto alfanumérico en mayúsculas.
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code
      from generate_series(1, 8);
    exit when not exists (select 1 from households where join_code = v_code);
  end loop;
  return v_code;
end;
$$;

comment on function household_generate_join_code() is
  'Código de unión permanente y regenerable (D-014): 8 caracteres, alfabeto sin O/0 ni I/1.';

revoke execute on function household_generate_join_code() from public;

create function create_household(p_name text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid := gen_random_uuid();
  v_join_code text;
  v_clean_name text := btrim(p_name);
  -- RF-020: conjunto inicial de categorías, sembrado al crear el hogar.
  v_categories text[] := array[
    'Frutas y verduras', 'Carnes', 'Lácteos', 'Despensa', 'Bebidas', 'Limpieza', 'Higiene'
  ];
  v_category_name text;
  v_position int := 0;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'create_household: se requiere sesión autenticada';
  end if;
  if v_clean_name is null or v_clean_name = '' then
    raise exception 'create_household: el nombre del hogar no puede estar vacío';
  end if;

  v_join_code := household_generate_join_code();

  insert into households (id, name, join_code) values (v_household_id, v_clean_name, v_join_code);
  insert into household_members (household_id, user_id) values (v_household_id, v_user_id);

  foreach v_category_name in array v_categories loop
    insert into categories (id, household_id, name, position, field_updated_at)
      values (
        gen_random_uuid(), v_household_id, v_category_name, v_position,
        jsonb_build_object('name', to_jsonb(v_now), 'position', to_jsonb(v_now))
      );
    v_position := v_position + 1;
  end loop;

  return jsonb_build_object(
    'household_id', v_household_id,
    'name', v_clean_name,
    'join_code', v_join_code
  );
end;
$$;

comment on function create_household(text) is
  'Crea el hogar, la membresía de quien lo crea y siembra las categorías de RF-020 (arquitectura, tabla de operaciones del dominio).';

create table household_join_attempts (
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);

comment on table household_join_attempts is
  'Limita el ritmo de join_household por usuario (arquitectura §5): el código de hogar es una credencial de facto y join_household es security definer, así que esta tabla -- no RLS -- es la única barrera contra fuerza bruta. Sin políticas: no se expone a los clientes (ver alter ... enable row level security más abajo).';

create index household_join_attempts_user_idx on household_join_attempts (user_id, attempted_at);

alter table household_join_attempts enable row level security;
-- Sin políticas: select/insert/update/delete deniegan por defecto para anon/authenticated.
-- Solo la escribe join_household, que es security definer.

create function join_household(p_code text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_household households%rowtype;
  v_recent_attempts int;
  -- ponytail: ventana y tope fijos en código. Si algún día hace falta ajustarlos sin migración,
  -- se vuelven una fila de configuración; con dos usuarios y un solo código, no hace falta ahora.
  v_max_attempts constant int := 5;
  v_window constant interval := interval '5 minutes';
begin
  if v_user_id is null then
    raise exception 'join_household: se requiere sesión autenticada';
  end if;

  select count(*) into v_recent_attempts
    from household_join_attempts
    where user_id = v_user_id and attempted_at > now() - v_window;

  if v_recent_attempts >= v_max_attempts then
    raise exception 'join_household: demasiados intentos, espera unos minutos';
  end if;

  -- Se cuenta el intento se acierte o no el código, que es lo que limita la fuerza bruta. Se
  -- inserta ANTES de mirar el código y esta función ya no lanza excepción por código inválido
  -- (ver más abajo): si lanzara, Postgres deshace la función entera -- este insert incluido -- y
  -- la cuenta de intentos nunca avanzaría, dejando el límite de más arriba sin efecto.
  insert into household_join_attempts (user_id) values (v_user_id);

  select * into v_household from households where join_code = v_code;
  if not found then
    return jsonb_build_object('joined', false, 'error', 'invalid_code');
  end if;

  insert into household_members (household_id, user_id)
    values (v_household.id, v_user_id)
    on conflict (household_id, user_id) do nothing;

  return jsonb_build_object(
    'joined', true,
    'household_id', v_household.id,
    'name', v_household.name,
    'join_code', v_household.join_code
  );
end;
$$;

comment on function join_household(text) is
  'Une al llamador al hogar de p_code (RF-022). Idempotente vía on conflict do nothing. Limitada por household_join_attempts (arquitectura §5).';

grant execute on function create_household(text) to authenticated;
grant execute on function join_household(text) to authenticated;
