-- Ajustes de rendimiento sin cambio de comportamiento, hallados al revisar las migraciones contra
-- la guía supabase-postgres-best-practices:
--
-- 1) Índices sobre columnas de llave foránea sin índice (household_id en las cuatro tablas
--    sincronizadas + household_members.user_id, category_id/supermarket_id en products, y
--    product_id sin filtrar en list_items). household-tables.ts (Fase 2a) trae la tabla completa
--    del hogar con `where household_id = X` -- exactamente el patrón que se beneficia -- y las
--    políticas RLS filtran por la misma columna en cada select.
-- 2) Las políticas RLS llamaban a is_member(...) sin envolverla en un `select`, lo que la
--    reevalúa fila por fila en vez de una sola vez por consulta (patrón "Optimize RLS Policies for
--    Performance" de la guía). is_member() es `stable`, así que envolverla no cambia qué filas
--    devuelve -- solo cuántas veces se ejecuta.
--
-- Ninguno de los dos cambia una sola fila devuelta por ninguna consulta existente: son válidos
-- para aplicar sin tocar el comportamiento que ya cubre la batería de integración de Fases 1 y 2b.

create index supermarkets_household_id_idx on supermarkets (household_id);
create index categories_household_id_idx on categories (household_id);
create index products_household_id_idx on products (household_id);
create index products_category_id_idx on products (category_id);
create index products_supermarket_id_idx on products (supermarket_id);
create index list_items_household_id_idx on list_items (household_id);
create index list_items_product_id_idx on list_items (product_id);
create index household_members_user_id_idx on household_members (user_id);

alter policy households_select_members on households
  using ((select is_member(id)));

alter policy household_members_select_members on household_members
  using ((select is_member(household_id)));

alter policy supermarkets_select_members on supermarkets
  using ((select is_member(household_id)));

alter policy categories_select_members on categories
  using ((select is_member(household_id)));

alter policy products_select_members on products
  using ((select is_member(household_id)));

alter policy list_items_select_members on list_items
  using ((select is_member(household_id)));
