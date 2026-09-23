-- Notificaciones push al finalizar una compra (docs/plan_notificaciones_push_v0.1.md, Fase P1).
-- Dos tablas nuevas, fuera del modelo de sincronización de las cuatro tablas del hogar
-- (CLAUDE.md): no entran en la caché persistida de TanStack Query, no tienen fusión LWW campo a
-- campo, no viajan por sync_push.
--
--   push_subscriptions  -- una fila por instalación de PWA (§5.1). RLS directa, no RPC: el propio
--                           documento (nota "ponytail:" en §5.1) señala que una política de
--                           insert/update/delete acotada a user_id = auth.uid() es tan segura como
--                           las dos funciones security definer que propone como alternativa,
--                           justo porque esta tabla está fuera del modelo de sincronización -- se
--                           toma esa vía porque ahorra dos funciones sin perder seguridad.
--   push_deliveries     -- registro de envíos, para la idempotencia por purchase_batch_id (§5.2).
--                           Vacía en esta fase: la Fase P2 (Edge Function con service role, trigger
--                           pg_net) es quien la llena. Sin políticas -- igual que
--                           household_join_attempts, ningún cliente la toca directamente.

create table push_subscriptions (
  endpoint      text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy push_subscriptions_rw_own on push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table push_subscriptions is
  'Una fila por instalación de PWA (dispositivo), no por hogar: con multi-hogar un mismo user_id cubre varios hogares (plan_notificaciones_push_v0.1 §5.1). RLS directa acotada a user_id = auth.uid(), sin RPC.';

create table push_deliveries (
  purchase_batch_id uuid primary key,
  household_id      uuid not null,
  notified_at       timestamptz not null default now(),
  recipients        int not null default 0
);

alter table push_deliveries enable row level security;
-- Sin políticas: solo la Edge Function send-purchase-push (service role, Fase P2) la toca.

comment on table push_deliveries is
  'Registro de envíos para idempotencia por purchase_batch_id (plan_notificaciones_push_v0.1 §5.2, §6). Vacía hasta la Fase P2.';
