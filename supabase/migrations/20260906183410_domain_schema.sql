-- Modelo de dominio: hogares, membresías, supermercados, categorías, productos e items de lista.
-- Forma tomada literalmente de docs/arquitectura_funcional_v0.1.md §2.
--
-- D-024: ningún id lleva `default gen_random_uuid()`. Se generan en el cliente con
-- crypto.randomUUID() para que la creación offline sea posible; un insert que se olvide del id
-- debe fallar en el acto (arquitectura §4.2), no degradar en silencio.

create table households (
  id          uuid primary key,
  name        text not null,
  join_code   text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table households is
  'El hogar es la unidad de aislamiento (arquitectura §2). join_code es permanente y regenerable (D-014).';

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

comment on table household_members is
  'Sin límite de miembros: deja la puerta abierta a más de dos usuarios por hogar (RNF-006).';

-- Las cuatro tablas sincronizadas (arquitectura §2.1, §4.2 y plan de implementación Fase 1):
-- supermarkets, categories, products, list_items. Comparten id/household_id/created_at/updated_at/
-- lápida/field_updated_at, llevan el trigger de updated_at, y son las que entran en la publicación
-- de Realtime. households y household_members quedan fuera: no tienen field_updated_at ni pasan
-- por sync_push (se escriben desde create_household / join_household).

create table supermarkets (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  name             text not null,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  field_updated_at jsonb not null default '{}'::jsonb
);

comment on column supermarkets.deleted_at is
  'Lápida absorbente (arquitectura §4.1): un borrado es definitivo, ningún parche posterior la resucita.';

create table categories (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  name             text not null,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  field_updated_at jsonb not null default '{}'::jsonb
);

comment on column categories.deleted_at is
  'Lápida absorbente (arquitectura §4.1): un borrado es definitivo, ningún parche posterior la resucita.';

create table products (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  name             text not null,
  brand            text,                                                     -- opcional, RF-012 / D-005
  category_id      uuid references categories(id) on delete set null,
  supermarket_id   uuid references supermarkets(id) on delete set null,      -- opcional, D-002
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  field_updated_at jsonb not null default '{}'::jsonb
);

comment on column products.deleted_at is
  'Lápida absorbente (arquitectura §4.1): un borrado es definitivo, ningún parche posterior la resucita.';
comment on column products.supermarket_id is
  'Preferencia, no restricción (D-002, D-027). Si apunta a un supermercado borrado, se pinta en "Sin asignar" (C-007), regla de pintado, no de datos.';

create table list_items (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  quantity         int  not null default 1 check (quantity > 0),            -- RF-011 / D-010
  checked          boolean not null default false,                          -- RF-015
  checked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_reason   text check (removed_reason in ('purchased', 'removed')),
  field_updated_at jsonb not null default '{}'::jsonb
);

comment on column list_items.removed_at is
  'Lápida NO absorbente (arquitectura §4.1): un campo más sujeto a último-en-escribir-gana, para que D-032 (deshacer finalización) pueda ponerlo a nulo. C-001 se resuelve en sync_push, no aquí.';
comment on column list_items.removed_reason is
  '''purchased'' vs ''removed'' distingue las dos formas de salir de la lista (RF-010, RF-017) y siembra el historial de V2 sin tabla adicional (D-026).';

-- Un producto está en la lista, o no está. No puede estar dos veces (arquitectura §2.2).
create unique index list_items_one_active_per_product
  on list_items (product_id) where removed_at is null;
