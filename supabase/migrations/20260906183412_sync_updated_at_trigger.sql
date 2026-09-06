-- Trigger `before update` que fuerza updated_at = now() en las cuatro tablas sincronizadas.
--
-- El `default now()` de la columna solo dispara en el insert (arquitectura §4.2): sin este
-- trigger, el delta pull no baja jamás una fila editada y todo parece funcionar hasta que alguien
-- edita algo y el otro dispositivo no se entera nunca. `updated_at` es el cursor de sincronización,
-- no debe confundirse con `field_updated_at` (la hora que decidió el usuario, acotada al servidor
-- en sync_push).

create function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Fuerza updated_at = now() del servidor en cada update, porque es el cursor del delta pull (CLAUDE.md, regla 6).';

create trigger set_updated_at before update on supermarkets
  for each row execute function set_updated_at();

create trigger set_updated_at before update on categories
  for each row execute function set_updated_at();

create trigger set_updated_at before update on products
  for each row execute function set_updated_at();

create trigger set_updated_at before update on list_items
  for each row execute function set_updated_at();
