-- Seguridad: is_member() y políticas RLS (arquitectura §5, D-039).
--
-- Con autenticación anónima (D-020), sin RLS cualquiera con la clave pública leería todos los
-- hogares. El hogar es la frontera de aislamiento: toda política se escribe una vez contra
-- household_id (o el id del hogar mismo) y vale para todo.

create function is_member(p_household uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from household_members
      where household_id = p_household and user_id = auth.uid()
    );
  $$;

comment on function is_member(uuid) is
  'security definer a propósito: una política sobre household_members que consultase household_members entraría en recursión infinita (arquitectura §5).';

alter table households enable row level security;
alter table household_members enable row level security;
alter table supermarkets enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table list_items enable row level security;

-- households: solo lectura para miembros. La creación y la unión por código las hará
-- create_household / join_household (security definer, Fase 1b) — quien se une todavía no es
-- miembro y por eso no podría ver la fila del hogar para buscarla por código si dependiera de RLS.
create policy households_select_members on households
  for select
  using (is_member(id));

comment on table households is
  'Sin política de insert/update: households se crea únicamente desde la función create_household (security definer, pendiente de Fase 1b).';

-- household_members: solo lectura para miembros del mismo hogar. Las altas las hace
-- join_household (security definer, Fase 1b).
create policy household_members_select_members on household_members
  for select
  using (is_member(household_id));

-- Las cuatro tablas sincronizadas (arquitectura §2.1 / §4.2): lectura sí, insert/update directos
-- NO (D-039). Toda escritura pasa por sync_push, una función security definer (pendiente de
-- Fase 1b) que aplica la fusión campo a campo. Sin políticas de insert/update, el motor las deniega
-- por defecto: la disciplina de "un solo camino de escritura" queda como restricción del servidor,
-- no como un acuerdo que hay que recordar.

create policy supermarkets_select_members on supermarkets
  for select
  using (is_member(household_id));

create policy categories_select_members on categories
  for select
  using (is_member(household_id));

create policy products_select_members on products
  for select
  using (is_member(household_id));

create policy list_items_select_members on list_items
  for select
  using (is_member(household_id));

comment on table supermarkets is
  'Escritura solo vía sync_push (D-039, pendiente de Fase 1b). RLS concede select, no insert/update.';
comment on table categories is
  'Escritura solo vía sync_push (D-039, pendiente de Fase 1b). RLS concede select, no insert/update.';
comment on table products is
  'Escritura solo vía sync_push (D-039, pendiente de Fase 1b). RLS concede select, no insert/update.';
comment on table list_items is
  'Escritura solo vía sync_push (D-039, pendiente de Fase 1b). RLS concede select, no insert/update.';
