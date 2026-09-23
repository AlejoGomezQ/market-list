# Plan — Notificación push al finalizar una compra

**Versión:** 0.1
**Fecha:** 2026-09-08
**Depende de:** `analisis_requerimientos_funcionales_app_mercado_v0.1.md` (ARF),
`decisiones_cerradas_v0.1.md` (D-001, D-013, D-018, D-024, D-026, D-028, D-029, D-039),
`arquitectura_funcional_v0.1.md` §3 (finalizar compra) y §4 (fusión), `estrategia_sincronizacion_v0.1.md`
(cola `sync_push`, cursor, delta pull), `experiencia_usuario_v0.1.md`, `identidad_visual_v0.1.md` §8.
**Relación con multi-hogar:** este plan asume el modelo de `plan_multi_hogar_y_copia_catalogo_v0.1.md`
(rama `feature/multi-hogar-y-copia-catalogo`, D-043…D-053) para "a quién se notifica", pero **no lo
requiere**: ver §12.
**Estado:** spike / documento de diseño. Corresponde a la Fase 8 del plan de implementación (idea de
`backlog_v2.md` sacada del uso real). **Este documento no lleva código de implementación**; los bloques
SQL, de payload y de Service Worker son ilustrativos.

---

## 1. Objetivo y caso de uso

Cuando alguien **finaliza una compra** —por supermercado, D-001— el resto de miembros del hogar reciben
una **notificación push** en el iPhone, sin abrir la app: en qué supermercado se cerró y, si se anotó al
cerrar, el total gastado (`backlog_v2.md` §6).

> Caso real: una persona hace la compra de Supermu. La otra, que está en casa, quiere enterarse **al
> momento** de que ya está hecha y de cuánto costó, sin tener que abrir la app a mirar.

Esto **reabre D-013** ("sin notificaciones push en el MVP"), que era coherente con excluir
"notificaciones avanzadas" del alcance inicial. Es una feature de V2, decidida por el usuario.

**Qué NO es esto:**

- No es un canal de sincronización. La lista de quien recibe la notificación **ya se actualiza** por
  Realtime y por delta pull (D-028): los comprados desaparecen de su Mercado en segundos, haya push o
  no. La notificación es un **aviso de atención**, no la fuente de verdad.
- No es sincronización en segundo plano (D-029 sigue en pie): el Service Worker que recibe el push
  **no** drena la cola ni baja datos; solo muestra la notificación.
- No hay notificaciones de nada más: ni de "te agregaron un producto", ni de "hay cambios pendientes".
  Solo el cierre de compra. Ampliar el catálogo de eventos es otra decisión, más adelante.

---

## 2. Viabilidad de Web Push en una PWA de iOS

Web Push existe en iOS desde **Safari 16.4** (marzo de 2023), con condiciones estrictas. Los dos
usuarios del hogar están en iPhone (CLAUDE.md), así que es viable, pero hay que verificarlo en
dispositivo real antes de construir nada (Fase P0).

### 2.1. Exigencias de iOS

- **La PWA tiene que estar añadida a la pantalla de inicio** y abrirse en `display: standalone`. En una
  pestaña normal de Safari en iOS **no hay Web Push**. El `manifest` ya declara `"display":
  "standalone"` (`vite.config.ts`).
- **iOS 16.4 o superior** (Ajustes de iOS → General → Información). Con iPhones de uso diario esto ya
  se cumple, pero se comprueba.
- **El permiso se pide desde un gesto del usuario** (`Notification.requestPermission()` dentro del
  handler de un toque). El sistema muestra su diálogo **una sola vez**. Si el usuario deniega, **no se
  puede volver a preguntar desde la web**: hay que ir a Ajustes de iOS → Notificaciones → Mercado.
- **`userVisibleOnly: true` es obligatorio** en `pushManager.subscribe(...)`: cada push **debe**
  producir una notificación visible, o iOS retira la capacidad de push ("silent push budget"). Nuestro
  caso siempre muestra una notificación, así que encaja sin fricción.
- **La suscripción puede cambiar o caducar.** El `endpoint` que devuelve el navegador puede dejar de
  valer; el envío recibe entonces `404`/`410` y hay que **borrar esa fila** (§5).
- **La PWA tiene que haberse abierto al menos una vez desde la pantalla de inicio** para que el
  registro del Service Worker y `pushManager` estén disponibles.

### 2.2. Qué verificar en un iPhone real (Fase P0)

1. Con la PWA instalada, tocar el interruptor de Ajustes dispara el diálogo del sistema **una vez** y,
   al aceptar, `pushManager.subscribe(...)` devuelve una suscripción con `endpoint` de Apple
   (`https://web.push.apple.com/...`).
2. Un envío de prueba (script Deno con las claves VAPID, §3) llega como notificación a los **dos**
   iPhone del hogar.
3. Tocar la notificación **abre o enfoca la PWA instalada** (`notificationclick` → `clients.openWindow`).
4. La suscripción **sobrevive** a cerrar y reabrir la PWA, y a reiniciar el teléfono.
5. Denegar el permiso deja la app en un estado legible (línea de estado en Ajustes, §8), no roto.
6. Forzar el cierre de la PWA y comprobar que el push **sigue llegando** (lo entrega el sistema, que
   levanta el Service Worker).

### 2.3. Limitaciones asumidas

- **Entrega ni inmediata ni garantizada al 100 %.** APNs puede retrasar la entrega en modo de bajo
  consumo, o descartarla si el teléfono lleva días sin red. Es aceptable: la notificación es un aviso;
  el estado real llega igualmente por Realtime/delta pull cuando el otro dispositivo se conecta.
- **Sin push silencioso y sin Background Sync** (D-029): el push no puede "sincronizar por detrás",
  solo mostrar algo.
- **El usuario puede desactivar las notificaciones en Ajustes de iOS** sin que la app se entere hasta
  el siguiente envío fallido (`403`/`410`), que limpia la fila.
- **Un `endpoint` por instalación de PWA.** Reinstalar la PWA genera una suscripción nueva; la vieja
  queda muerta hasta que un envío la marca para borrar.

---

## 3. Arquitectura sin coste (D-018)

**Web Push con VAPID directo al endpoint del navegador.** El servidor firma cada mensaje con un par de
claves VAPID (Voluntary Application Server Identification) y lo entrega cifrado al `endpoint` que dio
el navegador (Apple, Mozilla o Google, según el dispositivo). **No hay FCM, ni APNs con certificado de
Apple, ni servicio de terceros de pago.** El Apple Developer Program (99 USD/año) **no hace falta**
para Web Push: eso es justo lo que lo distingue de una app nativa (D-018).

**El envío va en una Edge Function de Supabase** (Deno), dentro de la capa gratis (500 000
invocaciones/mes; un hogar de dos personas hace del orden de decenas al mes). La Edge Function usa una
librería de Web Push para Deno (`npm:web-push` en modo compatibilidad, o un equivalente nativo de Deno)
y las claves VAPID como secretos de la función.

**Variables y secretos:**

| Dónde | Nombre | Papel |
|---|---|---|
| Cliente (Vercel, público) | `VITE_VAPID_PUBLIC_KEY` | Clave pública, va en `pushManager.subscribe({ applicationServerKey })`. |
| Edge Function (secreto) | `VAPID_PRIVATE_KEY` | Firma los mensajes. Nunca llega al cliente. |
| Edge Function (secreto) | `VAPID_SUBJECT` | `mailto:` de contacto que exige el estándar VAPID. |
| Edge Function (secreto) | `SUPABASE_SERVICE_ROLE_KEY` | Lee `push_subscriptions` de **otros** usuarios (salta RLS). |
| Postgres (config) | `app.push_fn_url`, `app.push_fn_key` | URL y token de la Edge Function, para el `pg_net` del trigger (§4). |

### 3.1. Diagrama de flujo

```
Dispositivo A (quien compra)              Supabase                         Dispositivo B (resto del hogar)
────────────────────────────             ────────                         ───────────────────────────────
Finalizar compra en Supermu
 · escritura optimista en caché
 · lote de parches  ->  cola (sync_push)
        │  (cuando A tiene red)
        ▼
   sync_push([...])  ───────────►  list_items:  N lápidas
                                   removed_reason = 'purchased'
                                   purchase_batch_id = B
                                   removed_at = ts ;  updated_at = now()   (trigger set_updated_at)
                                        │
                                   trigger  AFTER UPDATE ON list_items
                                   WHEN (transición a 'purchased')
                                        │  net.http_post  (pg_net)         · N llamadas, una por item
                                        ▼
                                   Edge Function  send-purchase-push
                                     1. insert push_deliveries(B) on conflict do nothing
                                          └─ ya existía  ->  salir            (idempotencia, D-058)
                                     2. ¿el lote B sigue comprado?            (cubre "deshacer", D-032)
                                          └─ no  ->  salir
                                     3. select push_subscriptions
                                          join household_members            (hogar del lote)
                                          where user_id <> finalized_by      (nunca a quien compró)
                                     4. por cada suscripción:
                                          Web Push cifrado + VAPID  ─────►  endpoint del navegador (Apple)
                                          404/410  ->  borrar la fila                    │
                                                                                        │  push
                                                                                        ▼
                                                                       Service Worker de B:  evento 'push'
                                                                         showNotification(
                                                                           'Compra finalizada en Supermu',
                                                                           { body: 'Total $85.400',
                                                                             tag: 'compra-B', data:{ url:'/' }})
                                                                                        │  el usuario toca
                                                                                        ▼
                                                                       evento 'notificationclick'
                                                                         -> clients.openWindow('/')

   (en paralelo, sin relación con el push:)
   sync_push  ->  Realtime / delta pull  ─────────────────────────────►  la lista de B ya pierde los comprados
```

---

## 4. El disparo es server-side, no desde el cliente

### 4.1. Por qué NO desde el cliente

Finalizar compra es **offline-capable**: `finalizeSection` (`src/lib/mutations/list-items.ts`) hace la
escritura optimista y encola un lote de parches por `sync_push` (D-039). El botón se pulsa **en la fila
de la caja**, que es donde peor va la cobertura (arquitectura §3). En el momento de finalizar, el
cliente puede no tener red; el lote sube minutos después. Si el cliente disparara la notificación:

- No podría, porque no tiene red cuando el usuario actúa.
- Si lo hiciera al drenar la cola, duplicaría el disparo en cada reintento (la cola reintenta con
  backoff indefinido, `estrategia_sincronizacion` §5).
- Necesitaría las claves VAPID privadas o un endpoint de envío abierto: superficie de abuso.

El disparo tiene que engancharse **cuando el lote aterriza en la BD**: las N lápidas de `list_items`
con `removed_reason = 'purchased'` y un `purchase_batch_id` común. Ese es el único punto determinista.

### 4.2. Opciones

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A. `pg_net` desde un trigger** (recomendada) | `AFTER UPDATE ON list_items` con `WHEN` acotado a la transición a `purchased`, que hace `net.http_post` a la Edge Function. | Latencia mínima (se dispara dentro de la transacción de `sync_push`). Control total del `WHEN`: solo dispara en finalizaciones reales, no en cada marcado. `pg_net` está disponible en la capa gratis. | Dispara **una vez por item** del lote (N llamadas); la colapsa la Edge Function (§6). Hay que guardar URL/token de la función en config de Postgres. |
| **B. Database Webhook de Supabase** | Un webhook sobre `UPDATE` de `list_items` que llama a la Edge Function. | Se configura desde el panel, es "lo canónico" de Supabase. Por debajo es exactamente `pg_net` + trigger. | El panel no deja poner una condición `WHEN` fina: el filtro (`removed_reason = 'purchased'`) acaba **dentro** de la función, así que **cada** marcado/desmarcado/cambio de cantidad invoca la Edge Function para nada. Más ruido y más invocaciones. |
| **C. Edge Function programada (pg_cron + poll)** | Un cron cada 1–2 min que busca lotes recientes sin notificar. | Desacopla del camino de escritura. Un solo disparo por lote. | Añade **1–2 min de latencia**: mata el "al momento" del caso de uso. Consume invocaciones programadas 24/7 aunque no haya compras. Sigue necesitando la tabla-registro. |

### 4.3. Recomendación

**Opción A: trigger `AFTER UPDATE ON list_items` con `pg_net`.** El `WHEN` restringe a la transición
real (`old.removed_at is null and new.removed_at is not null and new.removed_reason = 'purchased' and
new.purchase_batch_id is not null`), así que solo dispara al finalizar, nunca al marcar. Las N llamadas
por lote (N = items comprados, del orden de 5–15) las colapsa la Edge Function con la clave por
`purchase_batch_id` (§6), que además es el registro de idempotencia y el guardián del "deshacer". Es la
opción con menos latencia y menos piezas nuevas.

```sql
-- ilustrativo, no es la migración final
create extension if not exists pg_net with schema extensions;

create function notify_purchase_closed() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := current_setting('app.push_fn_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.push_fn_key')),
    body    := jsonb_build_object(
                 'purchase_batch_id', new.purchase_batch_id,
                 'household_id',       new.household_id,
                 'finalized_by',       auth.uid()));   -- SECURITY DEFINER no cambia auth.uid()
  return null;
end $$;

create trigger list_items_notify_purchase
  after update on list_items
  for each row
  when (old.removed_at is null and new.removed_at is not null
        and new.removed_reason = 'purchased'
        and new.purchase_batch_id is not null)
  execute function notify_purchase_closed();
```

`auth.uid()` dentro del trigger devuelve la identidad de **quien finalizó** (lo lee del JWT de la
petición; `SECURITY DEFINER` cambia el rol SQL, no las claims). Ese `finalized_by` viaja a la Edge
Function para **excluirlo de los destinatarios** (§5).

> `ponytail:` N llamadas HTTP por lote en vez de 1. Colapsan en la Edge Function y N es pequeño. Si
> algún día el volumen molesta, se interpone una tabla `push_jobs` con `insert ... on conflict
> (purchase_batch_id) do nothing` en el trigger y el webhook se mueve a esa tabla: 1 disparo por lote.

---

## 5. Modelo de datos

### 5.1. `push_subscriptions` — una fila por instalación de PWA

```sql
-- ilustrativo
create table push_subscriptions (
  endpoint      text primary key,                 -- identidad única de la suscripción del navegador
  user_id       uuid not null references auth.users(id) on delete cascade,
  p256dh        text not null,                    -- clave pública del cliente (cifrado del payload)
  auth          text not null,                    -- secreto de autenticación del cliente
  user_agent    text,                             -- para que el usuario reconozca el dispositivo
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy push_subscriptions_rw_own on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**Clave = `endpoint`, dueño = `user_id`. Sin `household_id`.** Una suscripción es de un **dispositivo**
(en realidad, de un registro de Service Worker), no de un hogar. Con multi-hogar (D-043) un dispositivo
= un `user_id` = varios hogares; poner `household_id` en la fila obligaría a reescribirla en cada
cambio de hogar. El hogar al que pertenece cada compra se resuelve **en el momento de enviar**, cruzando
con `household_members`:

```sql
-- destinatarios de un lote: miembros del hogar del lote, menos quien finalizó
select ps.endpoint, ps.p256dh, ps.auth
from   push_subscriptions ps
join   household_members hm on hm.user_id = ps.user_id
where  hm.household_id = :household_del_lote
  and  ps.user_id <> :finalized_by;
```

Esto vale igual con un hogar por dispositivo o con varios: una compra pertenece a exactamente un hogar.

**Cómo se escribe.** `push_subscriptions` **no** es una de las cuatro tablas sincronizadas: no entra en
la caché, no tiene fusión campo a campo, no viaja por `sync_push`. Se gestiona con dos RPC
`security definer` pequeñas, al estilo del resto de mutaciones del hogar (`create_household`,
`leave_household`, …):

- `save_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)` → `insert ... on conflict
  (endpoint) do update set last_seen_at = now(), user_id = auth.uid()`.
- `delete_push_subscription(p_endpoint)` → `delete ... where endpoint = p_endpoint and user_id =
  auth.uid()`.

> `ponytail:` una política RLS de `insert/update/delete` acotada a `user_id = auth.uid()` sobre esta
> tabla también sería segura y ahorraría las dos funciones. Se eligen las RPC solo por consistencia con
> el patrón "las escrituras del hogar pasan por una función" del repo. Si se prefiere, la RLS directa
> es aceptable aquí porque la tabla está fuera del modelo de sincronización.

### 5.2. `push_deliveries` — registro de envíos (idempotencia)

```sql
-- ilustrativo
create table push_deliveries (
  purchase_batch_id uuid primary key,
  household_id      uuid not null,
  notified_at       timestamptz not null default now(),
  recipients        int  not null default 0
);

alter table push_deliveries enable row level security;   -- sin políticas: solo la Edge Function
                                                          -- (service role) la toca. Como
                                                          -- household_join_attempts.
```

### 5.3. Relación con multi-hogar

- Se notifica a los **miembros del hogar del lote** (`household_members.household_id =
  list_items.household_id`), nunca a quien finalizó (`user_id <> finalized_by`).
- Un dispositivo miembro de varios hogares recibe la notificación de **cualquiera** de sus hogares,
  esté activo o no en ese dispositivo. Es deseable: "en tu otro hogar se cerró una compra" sigue siendo
  información útil. `notificationclick` abre la app; si el lote es de un hogar no activo, ver §9,
  pregunta abierta.
- Ver §12 para qué cambia si multi-hogar no llega antes que esta feature.

---

## 6. Idempotencia

Finalizar se reintenta desde la cola (`estrategia_sincronizacion` §5). Y el trigger de §4 dispara **una
vez por item** del lote. La notificación **no puede salir dos veces por la misma compra**.

**Clave: `purchase_batch_id`.** La Edge Function, como primer paso, hace:

```ts
const { error: yaEnviada } = await db
  .from("push_deliveries")
  .insert({ purchase_batch_id, household_id });
if (yaEnviada) return new Response("ya enviada", { status: 200 });   // otra invocación ganó
```

El `primary key` sobre `purchase_batch_id` hace que **la primera invocación gane** y las demás (las
otras N−1 del mismo lote, o el reenvío desde la cola) salgan sin hacer nada. No hace falta lock: el
`insert` es la sección crítica.

**Guardián del "deshacer" (D-032).** Si el usuario finaliza y deshace en segundos, ambos lotes de
parches pueden subir juntos: `sync_push` aplica la finalización (el trigger encola el disparo) y
después el deshacer (`removed_at → null`). El disparo ya está en vuelo. Antes de enviar, la Edge
Function revalida:

```ts
const { count } = await db.from("list_items")
  .select("*", { count: "exact", head: true })
  .eq("purchase_batch_id", purchase_batch_id)
  .eq("removed_reason", "purchased")
  .not("removed_at", "is", null);
if (!count) return new Response("lote revertido", { status: 200 });
```

Si el lote se revirtió, no hay nada que anunciar. (La fila de `push_deliveries` queda escrita: si el
usuario vuelve a finalizar el mismo lote —mismo `purchase_batch_id`, que `buildUndoFinalize` pone a
`null` y una nueva finalización regenera— no aplica; un `undo` seguido de re-finalizar produce un
`batch_id` nuevo, así que sí se notificaría. Correcto.)

---

## 7. Service Worker

El Service Worker **ya es obligatorio** (D-018) y hoy lo genera `vite-plugin-pwa` en modo
`generateSW` (Workbox), con **una sola regla de runtime**: todo lo que va a `*.supabase.co` es
`NetworkOnly` (`vite.config.ts`). La regla 7 de CLAUDE.md: *el Service Worker cachea el armazón, nunca
las llamadas a Supabase*.

### 7.1. Cómo encajan los manejadores

Se añaden dos manejadores —`push` y `notificationclick`— **sin cambiar la estrategia `generateSW`** y
**sin tocar la regla `NetworkOnly`**: Workbox permite inyectar scripts propios en el SW generado con
`workbox.importScripts`.

```ts
// vite.config.ts (ilustrativo)
VitePWA({
  registerType: "prompt",
  workbox: {
    importScripts: ["/push-sw.js"],          // script propio, servido como asset estático
    runtimeCaching: [ /* la regla NetworkOnly de Supabase, intacta */ ],
  },
})
```

```js
// public/push-sw.js (ilustrativo — NO sincroniza nada, D-029)
self.addEventListener("push", (event) => {
  const { title, body, tag, url } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,                                   // ausente si la compra se cerró sin total
      tag,                                    // "compra-<batchId>": re-entrega reemplaza, no apila
      icon: "/pwa-192x192.png",
      badge: "/badge-mono.png",               // monocromo, sin color (identidad_visual §2, §5)
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => "focus" in w);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
```

### 7.2. Reglas que no se rompen

- **El handler `push` no llama a Supabase.** No drena la cola, no hace delta pull, no lee datos: solo
  `showNotification`. La sincronización sigue ocurriendo **solo con la app abierta** (D-029). Todo lo
  que necesita para pintar la notificación viene en el payload del push.
- **La regla `NetworkOnly` de Supabase se queda como está.** `importScripts` añade manejadores de
  eventos, no reglas de caché.
- **El aviso de versión nueva (`registerType: "prompt"`, Fase 7) sigue funcionando.** El script
  inyectado no interfiere con el ciclo de actualización del SW.
- **`registrar` la suscripción es cosa del cliente**, no del SW: la app llama a
  `registration.pushManager.subscribe(...)` y manda el resultado a `save_push_subscription` (§5.1).

---

## 8. Tono y contenido de la notificación

`identidad_visual` §8: español, en frase, voz activa, una sola cosa por frase, **sin emojis** (D-035),
sin signos de adorno. Los botones dicen lo que va a pasar y el resultado repite la palabra:
`Finalizar compra` → `Compra finalizada`.

| Situación | Título | Cuerpo |
|---|---|---|
| Compra cerrada **con total** | `Compra finalizada en Supermu` | `Total $85.400` |
| Compra cerrada **sin total** | `Compra finalizada en Supermu` | *(sin cuerpo)* |

- **El total se formatea igual que en el Historial**: símbolo `$` antepuesto, separador de miles, sin
  decimales (`$85.400`), como `formatCurrency` en `src/lib/format.ts`. La Edge Function replica esa
  línea (`Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })`); es una línea, no se comparte
  módulo entre cliente y función.
- **Sin el cuerpo si no se anotó total.** No se rellena con "toca para ver" ni con un lamento. Un
  título solo es una notificación válida.
- **No se dice quién compró.** La app no tiene nombres de usuario (autenticación anónima, sin login,
  RF-022): no hay un "Ana cerró la compra" que poner. El título es impersonal a propósito.
- **El nombre del supermercado va tal cual lo escribió el usuario** (`supermarkets.name`), sin
  mayúsculas forzadas: las mayúsculas del rótulo son señalización *dentro* de la app (D-037), no de una
  notificación del sistema.
- **`tag: "compra-<batchId>"`**: si el push se re-entrega, la notificación se reemplaza en vez de
  apilarse.

---

## 9. Respuesta a las cuatro preguntas abiertas del issue

### P1 — ¿Cuándo se pide el permiso: onboarding, primera finalización, interruptor en Ajustes?

**Recomendación: un interruptor en Ajustes como control canónico, más una invitación única la primera
vez que el usuario finaliza una compra. Nunca en el onboarding.**

- **Nunca en onboarding.** iOS muestra el diálogo del sistema **una sola vez**; pedirlo antes de que el
  usuario entienda para qué sirve es la vía directa a un "No permitir" permanente que solo se revierte
  desde Ajustes de iOS. Además el onboarding ya tiene su trabajo (crear/unirse, dar de alta
  supermercados).
- **Interruptor en Ajustes**, en la sección del hogar: "Avisarme cuando se cierre una compra", apagado
  por defecto. Encenderlo dispara `requestPermission()` (gesto del usuario) y `subscribe(...)`.
  Apagarlo hace `unsubscribe()` + `delete_push_subscription`. Es una acción infrecuente, así que el
  diálogo del sistema aquí no choca con RNF-001 (misma excepción que el botón de `join_household`).
- **Invitación única tras la primera finalización.** Justo cuando el usuario acaba de ver el valor
  ("acabo de cerrar la compra, estaría bien que a la otra persona le llegue"), en el mismo sitio que el
  aviso de "deshacer" (D-032), una línea discreta: *"¿Quieres que avisemos al hogar cuando cierres una
  compra?"* con un botón que lleva al interruptor (o lo activa en el sitio). Se muestra **una vez**; si
  se ignora, no vuelve —el interruptor de Ajustes queda como única vía.

### P2 — ¿Webhook de BD, `pg_net` desde trigger, o Edge Function programada?

**Recomendación: `pg_net` desde un trigger `AFTER UPDATE ON list_items`** con `WHEN` acotado a la
transición a `purchased` (§4.3). Menos latencia que el cron (que mataría el "al momento"), más control
del filtro que el Database Webhook del panel (que acabaría invocando la función en cada marcado). Las N
llamadas por lote las colapsa la Edge Function por `purchase_batch_id`, que ya es el registro de
idempotencia.

### P3 — Dos supermercados finalizados seguidos: ¿dos notificaciones o una agrupada?

**Recomendación: una notificación por `purchase_batch_id`. No se agrupan.**

Finalizar es **por supermercado** (D-001) y son eventos genuinamente distintos —el ARF pone el ejemplo
de "Supermu el martes y D1 el sábado"—. Aun seguidos, "cerré Supermu" y "cerré D1" son dos hechos con
su total cada uno. Agrupar exige una ventana temporal, estado intermedio y una regla de "cuánto
esperar" para un caso poco frecuente y donde separar es además **más correcto**. iOS ya apila
visualmente las notificaciones de la misma app. Cero coalescencia (mismo criterio que la cola de
`sync_push`, `estrategia_sincronizacion` §4.3).

### P4 — Destinatario sin PWA instalada o sin permiso: ¿degradar en silencio o avisar en la app?

**Recomendación: degradación silenciosa del push, más una línea de estado en Ajustes. Sin aviso
in-app sobre la compra.**

- **El push simplemente no se envía** a quien no tiene suscripción (no hay fila en
  `push_subscriptions`). No es un error: la Edge Function envía a quien puede y registra `recipients`.
- **La información no se pierde**: la lista de esa persona ya pierde los comprados por Realtime/delta
  pull (D-028). Lo único que no ocurre es "enterarse sin abrir la app", y para quien no activó las
  notificaciones eso es coherente.
- **Una línea de estado en Ajustes**, solo informativa: si el permiso está denegado o el interruptor
  apagado, *"Las notificaciones están desactivadas en este dispositivo"* con un enlace a activarlas (o
  la explicación de que hay que ir a Ajustes de iOS si están denegadas a nivel de sistema).
- **Ningún banner ni toast** del tipo "se finalizó una compra": duplicaría lo que la lista ya muestra y
  sería exactamente el ruido que la app evita.

---

## 10. Decisiones nuevas propuestas

Numeradas **D-054 … D-062**, continuando desde **D-053** (la última usada, en
`plan_multi_hogar_y_copia_catalogo_v0.1.md` §2). **Propuestas, pendientes de aprobación del usuario.**
Se incorporarían a `decisiones_cerradas_v0.1.md` al cerrarse.

### D-054 — Notificación push al finalizar compra (reabre D-013)

Cuando un lote de compra (`purchase_batch_id`) aterriza en la BD como lápidas de `list_items` con
`removed_reason = 'purchased'`, se envía una notificación push a los **miembros del hogar de ese lote,
excepto a quien finalizó**. Es opt-in, server-side y solo para este evento. Deja sin efecto D-013
("sin notificaciones push en el MVP") para V2. *Propuesta.*

### D-055 — Transporte: Web Push con VAPID directo, sin FCM ni coste

El servidor firma cada mensaje con un par VAPID y lo entrega al `endpoint` del navegador. Sin FCM, sin
certificado APNs de Apple, sin servicio de pago. El envío va en una Edge Function de Supabase (capa
gratis). Coherente con D-018. *Propuesta.*

### D-056 — Disparo: trigger `pg_net` sobre `list_items`

Un trigger `AFTER UPDATE ON list_items`, con `WHEN` acotado a la transición a `purchased` con
`purchase_batch_id` no nulo, llama por `pg_net` a la Edge Function. **No** se dispara desde el cliente:
finalizar es offline-capable y pasa por la cola (D-039), el cliente puede no tener red en la caja.
Descartados el Database Webhook del panel (filtro `WHEN` insuficiente) y el cron (latencia). *Propuesta.*

### D-057 — `push_subscriptions` por dispositivo, sin `household_id`

Una fila por instalación de PWA: clave `endpoint`, dueño `user_id`, más `p256dh`/`auth`. El hogar se
resuelve al enviar, cruzando con `household_members`. No lleva `household_id` porque con multi-hogar un
dispositivo cubre varios hogares con un solo `user_id`. Se escribe con dos RPC `security definer`
(`save_push_subscription` / `delete_push_subscription`); está fuera del modelo de las cuatro tablas
sincronizadas. *Propuesta.*

### D-058 — Idempotencia por `purchase_batch_id`

Tabla `push_deliveries` con `primary key (purchase_batch_id)`. La Edge Function hace `insert ... `
como primer paso: la primera invocación gana, las N−1 restantes del mismo lote y los reintentos de la
cola salen sin enviar. Antes de enviar, revalida que el lote sigue comprado (cubre el "deshacer" de
D-032). *Propuesta.*

### D-059 — El permiso se pide en Ajustes, más una invitación única tras la primera finalización

Interruptor "Avisarme cuando se cierre una compra" en Ajustes (apagado por defecto) como control
canónico. Una sola vez, tras la primera finalización del usuario, una invitación discreta junto al
aviso de "deshacer". Nunca en el onboarding: iOS solo muestra el diálogo del sistema una vez y un
prompt sin contexto se deniega para siempre. *Propuesta.*

### D-060 — Una notificación por `purchase_batch_id`, sin agrupar

Finalizar es por supermercado (D-001); cada cierre es un evento con su total. No se agrupan cierres
seguidos: exigiría ventana temporal y estado para un caso raro donde separar es más correcto. *Propuesta.*

### D-061 — Sin permiso o sin PWA: degradación silenciosa + línea de estado en Ajustes

No se envía push a quien no tiene suscripción; no es error. La lista de esa persona se actualiza igual
por Realtime/delta pull (D-028). En Ajustes, una línea informativa cuando las notificaciones están
apagadas o denegadas. Ningún banner ni toast in-app sobre la compra. *Propuesta.*

### D-062 — El Service Worker suma `push`/`notificationclick` sin cambiar de estrategia

Se mantiene `generateSW` de `vite-plugin-pwa` y la regla `NetworkOnly` sobre Supabase (regla 7 de
CLAUDE.md). Los dos manejadores se inyectan con `workbox.importScripts` desde un script propio. El
handler `push` **solo** hace `showNotification`: no sincroniza (D-029). *Propuesta.*

---

## 11. Plan de implementación por fases

Al estilo de `plan_implementacion_v0.1.md`: cada fase con criterio de "listo" comprobable, tamaño
relativo S/M/L. Commit + push al terminar cada una (preferencia del usuario). Orden pensado para
delegar cada fase a un worker.

### Fase P0 — Spike de viabilidad en iPhone real · S

Sin tocar la app de producción. Par de claves VAPID generado. Un `push-sw.js` mínimo servido en local o
en un preview de Vercel, una suscripción hecha a mano desde la consola, y un script Deno que envía un
push con las claves.

**Listo cuando:** con la PWA en la pantalla de inicio de los **dos** iPhone del hogar, el script hace
llegar una notificación a ambos; tocarla abre la PWA; la suscripción sobrevive a cerrar y reabrir la
app; denegar el permiso no rompe nada. Si algo de §2.1 no se cumple en dispositivo real, **el resto del
plan se detiene** y se reevalúa.

### Fase P1 — Modelo de datos y suscripción · M

Migraciones: `push_subscriptions` + RLS, `push_deliveries` + RLS sin políticas, RPC
`save_push_subscription` / `delete_push_subscription` con sus wrappers Zod. Cliente: interruptor en
Ajustes ("Avisarme cuando se cierre una compra"), que hace `requestPermission()` + `subscribe()` +
RPC, y su inverso. Línea de estado en Ajustes (D-061). Revalidación de la suscripción en el arranque
(re-subir si cambió el `endpoint`).

**Listo cuando:** activar el interruptor en un iPhone crea exactamente una fila en `push_subscriptions`;
desactivarlo o revocar el permiso en iOS la borra en el siguiente arranque; reinstalar la PWA y
reactivar no deja filas huérfanas contando dos veces al mismo dispositivo; los tests de integración
cubren que un usuario solo ve y borra sus propias suscripciones.

### Fase P2 — Disparo y envío · L

Migración del trigger `pg_net` (§4.3) y `create extension pg_net`. Edge Function `send-purchase-push`:
idempotencia por `push_deliveries`, guardián del "deshacer", consulta de destinatarios
(`household_members`, `user_id <> finalized_by`), Web Push con VAPID, borrado de filas en `404`/`410`,
formato del total. Config de Postgres con URL y token de la función.

**Listo cuando:** finalizar una compra en un iPhone hace llegar al otro `Compra finalizada en Supermu ·
Total $85.400` en segundos; finalizar sin total llega sin cuerpo; **quien finaliza no recibe nada**;
reintentar el mismo lote desde la cola (simulado) no manda una segunda notificación; finalizar y
deshacer en segundos no manda ninguna; una suscripción caducada se borra sola tras el primer envío
fallido. Prueba con los dos iPhone reales.

### Fase P3 — Integración con el Service Worker de producción y pulido · S

Mover los manejadores al SW generado vía `workbox.importScripts` (`public/push-sw.js`). Invitación
única tras la primera finalización (D-059). Textos definitivos (`identidad_visual` §8). Un escenario
Playwright para el interruptor de Ajustes (permiso concedido/denegado con el mock de Playwright); el
envío real se sigue probando a mano en iPhone (`estrategia_sincronizacion` §12).

**Listo cuando:** el build de producción incluye los manejadores en el SW generado, la regla
`NetworkOnly` de Supabase sigue intacta, el aviso de versión nueva (Fase 7) sigue funcionando, y CI
pasa en verde.

### Fase P4 — Documentación · S

- `decisiones_cerradas_v0.1.md`: incorporar D-054 … D-062.
- `backlog_v2.md`: añadir/actualizar la entrada de "notificación push al finalizar compra" marcándola
  planificada en este documento (como se hizo con §5–§7 del backlog).
- `arquitectura_funcional_v0.1.md` §3: añadir "notificar cierre de compra" como efecto secundario
  server-side de finalizar, y nota de que el trigger de `list_items` es el primer disparo por `pg_net`
  del sistema.
- `experiencia_usuario_v0.1.md` §10: el interruptor de notificaciones en Ajustes y la invitación tras
  la primera finalización.
- `CLAUDE.md`: nota en las reglas del local-first de que el SW suma manejadores `push`/`notificationclick`
  que **no** sincronizan (D-029 intacto).

**Listo cuando:** ningún documento describe la app como "sin notificaciones push" sin matizar que
D-013 se reabrió en V2, y las nueve decisiones nuevas están en `decisiones_cerradas`.

---

## 12. Dependencia de multi-hogar

Este diseño se apoya en el modelo de `plan_multi_hogar_y_copia_catalogo_v0.1.md` (rama sin fusionar a
`master` a fecha de este documento). Qué asume y qué cambia si multi-hogar **no** llega antes:

### 12.1. Qué asume del modelo multi-hogar

- **`household_members` es N:M** (`primary key (household_id, user_id)`, sin `unique(user_id)`) y
  `is_member(p_household)` comprueba pertenencia a un hogar concreto. Esto **ya es así en el esquema
  actual** (`20260906183414_rls_and_security.sql`), lo use multi-hogar o no.
- **La suscripción se guarda por `user_id`, no por hogar** (D-057). Con multi-hogar esto evita
  reescribir la fila en cada cambio de hogar; sin multi-hogar es simplemente la forma natural (un
  usuario, un hogar, una fila que sirve igual).
- **El envío cruza `push_subscriptions` con `household_members` filtrando por el hogar del lote.** Esa
  consulta es idéntica con uno o con varios hogares por dispositivo.

### 12.2. Qué cambia si multi-hogar NO se implementa antes

- **Nada estructural.** Todo el diseño (tabla, trigger, Edge Function, SW) funciona con un hogar por
  dispositivo sin tocar una línea.
- **Se simplifica `notificationclick`.** Con un solo hogar, tocar la notificación solo tiene que abrir
  la app en `/`. Con multi-hogar hay una **pregunta abierta**: si el lote es de un hogar que **no** es
  el activo en ese dispositivo (la sincronización es solo del activo, D-044), ¿`notificationclick`
  cambia el hogar activo —lo que fuerza recarga, D-044— o solo abre la app y deja que el usuario cambie
  a mano? Recomendación provisional: **abrir la app sin cambiar de hogar**; si el uso real muestra que
  molesta, `notificationclick` lleva el `household_id` en `data` y ofrece cambiar. Se decide en la Fase
  P3 o se difiere a la Fase 8.
- **El interruptor de Ajustes.** Con multi-hogar, Ajustes ya muestra "hogar activo" como primera
  sección (D-045); el interruptor de notificaciones va debajo, en la sección del hogar. La suscripción
  es del dispositivo, no del hogar activo, así que **un solo interruptor** cubre todos los hogares del
  usuario. No hay un interruptor por hogar.
- **Orden de merge.** Si esta feature se implementa **antes** que multi-hogar, las RPC
  `save_push_subscription` / `delete_push_subscription` no chocan con nada de multi-hogar (que toca
  `regenerate_household_code`, `leave_household`, `list_households`, `copy_catalog`). Si se implementa
  **después**, tampoco: son migraciones aditivas y una tabla nueva.

### 12.3. Interacción con "salir de un hogar" (D-047/D-048)

Cuando un usuario sale de un hogar (`leave_household`), su fila de `household_members` para ese hogar
desaparece, así que **deja de recibir notificaciones de ese hogar automáticamente** (la consulta de
destinatarios ya no lo incluye). No hay que limpiar `push_subscriptions`: la suscripción sigue siendo
válida para los hogares que le queden. Si era su último hogar, la fila de `push_subscriptions` se
queda hasta que el usuario apague el interruptor o el `on delete cascade` de `auth.users` la retire.
