-- Publicación de Realtime sobre las cuatro tablas sincronizadas (arquitectura §4.2, §6 / RF-016).
-- households y household_members quedan fuera: no participan de sync_push ni del delta pull por
-- cursor, y cambian con muy poca frecuencia (alta de hogar, unión, regeneración de código).

alter publication supabase_realtime add table supermarkets;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table products;
alter publication supabase_realtime add table list_items;
