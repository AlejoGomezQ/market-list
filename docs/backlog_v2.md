# Backlog de V2

**Versión:** 0.1
**Fecha:** 2026-09-07

Ideas que han surgido usando la app de verdad (Fase 8 del plan de implementación). Este documento
complementa lo que ya se dejó fuera a propósito en `decisiones_cerradas_v0.1.md` §6 y en el ARF
(historial, precios, estadísticas, sugerencias automáticas, ubicación/GPS), que sigue siendo la
lista canónica de lo descartado.

**Cómo se gestiona.** El seguimiento vivo (prioridad, estado, quién) está en los **issues de
GitHub**; este documento es la fuente de verdad del *porqué* de cada punto y de sus preguntas
abiertas. Cada punto pendiente tiene un issue que enlaza aquí.

**Estado actual:**

| # | Tema | Estado |
|---|---|---|
| 1 | Pertenecer a varios hogares | Hecho (`feature/multi-hogar-y-copia-catalogo`, PR #10) |
| 2 | Copiar catálogo entre hogares | Hecho (`feature/multi-hogar-y-copia-catalogo`, PR #10) |
| 3 | Compartir la lista a WhatsApp | Hecho |
| 4 | Orden de recorrido por supermercado | Pendiente — issue #11 |
| 5 | Historial de compras | Hecho (`feature/historial-compras`) |
| 6 | Total gastado por compra (+ editable) | Hecho |
| 7 | Errores legibles + Sentry | Hecho; flecos en issue #14 |
| 8 | Volver a entrar a un hogar sin perder nada | Pendiente — issue #12 |
| 9 | Roles en el hogar (creador = admin) | Pendiente — issue #13 |
| 10 | Filtro por categoría en la lista de Mercado | Pendiente — issue #15 |
| 11 | Notificación push al finalizar una compra | Pendiente — issue #16 |

---

## 1. Pertenecer a más de un hogar y cambiar entre ellos — implementado en `feature/multi-hogar-y-copia-catalogo`

Caso: una persona con su hogar y, además, el de sus papás o el de una casa compartida.

**Lo que se hizo** (diseño en `plan_multi_hogar_y_copia_catalogo_v0.1.md`, decisiones D-043…D-048,
D-053):

- El vínculo de `localStorage` pasa de un objeto a `{ households: HouseholdLink[], activeId }`, con
  migración transparente del formato viejo al leer. `getHouseholdLink()` mantiene la firma y devuelve
  el activo, así que los ~8 llamadores no se tocaron (D-043).
- **Selector de hogar en Ajustes**, como primera sección — no en la cabecera de Mercado (D-045).
  Onboarding suma el modo `/onboarding?add=true` para "añadir otro hogar" a quien ya tiene uno
  (D-046).
- La sincronización opera **solo sobre el hogar activo** (D-044). El cursor del delta pull pasa a
  `sync:cursor:<householdId>:<entity>`. Cambiar de hogar recarga la app.
- `regenerate_household_code` y `leave_household` reciben `p_household_id` y validan `is_member`
  (D-048). Nueva `list_households()` como fuente de verdad del selector; al abrir Ajustes se
  reconcilia con ella y se podan los hogares de los que te expulsaron, con aviso (D-053).
- Salir de un hogar con otros pendientes hace limpieza selectiva de su caché y cursores, no la global
  (D-047).

Lo que quedó fuera y se aborda aparte: volver a entrar a un hogar sin perder nada tras
salir/reinstalar (§8), y roles de hogar (§9).

## 2. Copiar el catálogo de productos de un hogar a otro — implementado en `feature/multi-hogar-y-copia-catalogo`

Caso: una familia nueva parte del catálogo de otro hogar en vez de dar de alta ~100 productos a mano.

**Lo que se hizo** (decisiones D-049…D-052):

- RPC `copy_catalog(origen, destino, copiar_supermercados, copiar_categorias)`, `security definer`,
  con `is_member` sobre **ambos** hogares, todo en una transacción — no ~100 parches por `sync_push`
  (D-049). Es una excepción acotada a D-039, con el precedente de la siembra de categorías de
  `create_household`.
- Copia productos activos y, según los dos flags, sus categorías y supermercados. Categorías y
  supermercados se emparejan con los del destino por nombre; los que faltan se crean con id nuevo. Un
  producto cuyo `(nombre, marca)` ya exista en el destino se omite — resuelve D-006 en masa. No copia
  items de lista ni lápidas. Idempotente (D-050). El color sale del orden `position`, no se copia
  (D-052).
- Para copiar hay que ser miembro del origen: la feature se apoya en "añadir otro hogar" (§1) para la
  entrada del código y solo añade un selector de origen y la llamada (D-051).
- UI: drawer `CopyCatalogDrawer` con selector de origen, dos casillas (categorías / supermercados),
  guardia de conexión y resultado "Catálogo copiado · N productos". Entradas desde Ajustes y desde el
  estado vacío del Catálogo. Tras copiar, un delta pull forzado repinta Mercado y Catálogo sin
  recargar.

## 3. Compartir la lista a WhatsApp — implementado

Caso: mandar "lo que falta" a alguien que va a hacer la compra y **no tiene la app**.

**Lo que se hizo** (commits `63d208e`, `5094382`):

- `src/lib/share.ts`: `shareText()` usa `navigator.share()` (Web Share API, Safari iOS y PWA
  instalada) y cae a copiar al portapapeles si no está; nunca lanza, devuelve
  `shared` / `copied` / `cancelled` / `failed` para que el llamador decida el aviso.
- `formatMarketListForSharing` (`src/lib/selectors.ts`) genera el texto plano a partir de la lista
  **agrupada**: una sección por supermercado con pendientes, cantidad solo si es mayor que 1
  (identidad_visual §4), tono de identidad_visual §8.
- Se dispara desde **un icono en la cabecera de Mercado** que comparte la lista entera; se oculta
  cuando no hay pendientes. El botón al pie de cada sección se quitó por invasivo.
- También se comparte el código del hogar desde el onboarding con el mismo mecanismo.

## 4. Orden de recorrido propio por supermercado (RF-021) — issue #11

Hoy, dentro de cada supermercado la lista se ordena **por categoría** (D-031,
`groupMarketListBySupermarket` en `src/lib/selectors.ts`), como aproximación al recorrido de la
tienda. Pero cada supermercado tiene otro orden de pasillos, y yendo con el carro de verdad tener
los productos desordenados respecto al recorrido es fricción sobre el caso de uso central. D-031 ya
lo anticipa: *"El recorrido propio de cada supermercado (RF-021) sustituirá este orden en V2."*

**Toca:**

- Una columna o tabla de orden por `(supermarket_id, category_id)` (o por producto). El modelo ya
  debe dejar sitio (CLAUDE.md).
- El selector de agrupación/orden de la lista de Mercado.
- Una UI para reordenar con una mano (flechas arriba/abajo antes que arrastrar), probablemente en
  Ajustes por supermercado, o en la propia sección de Mercado.

## 5. Historial de compras — implementado en `feature/historial-compras`

Consultar qué se compró y cuándo, en una lista que se repite. Fue **barato**: D-026 ya guardaba las
lápidas de `list_items` con `removed_at` y `removed_reason` (`'purchased'` frente a `'removed'`),
literalmente *"para sembrar el historial de V2 sin tabla adicional"*.

**Lo que se hizo:**

- Finalizar escribe un `purchase_batch_id` (uuid de cliente, D-024) común a todas las lápidas del
  lote — así el historial agrupa por compra en vez de por `removed_at` cercano. Las lápidas
  pre-migración sin batch se agrupan por `removed_at` exacto como fallback.
- Tercera pestaña **Historial** (D-042), pantalla de solo lectura. Se deriva en memoria de
  `list_items` con `groupPurchaseHistory` (`src/lib/selectors.ts`) — sin quinta consulta persistida.
- Sin tabla `purchases`: el lote vive en columnas de `list_items` (`purchase_batch_id`,
  `purchase_total`).

## 6. Total gastado por compra — implementado en `feature/historial-compras`

Al finalizar una compra (el drawer de confirmación en `src/routes/mercado-screen.tsx`), un campo
**opcional** para el **total gastado**. Un solo número por compra, no precios por producto. En el
Historial (punto 5), cada compra muestra su total.

**Lo que se hizo:**

- `purchase_total` en la lápida del lote (nullable). El campo es opcional: finalizar sigue
  funcionando sin escribir nada (D-001, finalizar no se bloquea).
- Formato de moneda con símbolo fijo antepuesto (`$85.400`), separador de miles, sin decimales
  (`Intl.NumberFormat('es-CO')`, `src/lib/format.ts`). No hay campo de moneda del hogar.

**Extensión hecha después** (commit `74b4041`, `feature/total-editable-y-errores`):

- **Total editable desde el Historial.** Ya se puede corregir una cifra mal tecleada o añadir el
  total a una compra que se cerró sin él, desde la pantalla de Historial.

## 7. Errores legibles para el usuario + seguimiento interno de logs — implementado en `feature/sentry`

Hoy algunos fallos enseñan el texto crudo de la excepción al usuario. Un ejemplo real: cuando
IndexedDB falla al abrir una transacción, llega a pantalla algo como
`Failed to execute 'transaction' on 'IDBDatabase': ...`.

**Lo que se hizo:**

- `src/lib/errors.ts`: `toUserMessage(error)` traduce la excepción a una frase en español con el
  tono de `identidad_visual §8` (IndexedDB, error de Supabase, red, Zod, `SyncError`/`SyncConfigError`);
  nunca deja escapar el `.message` crudo. `AppError` marca los mensajes que YA están escritos para el
  usuario (p. ej. "Ese código no corresponde a ningún hogar.") y pasan tal cual.
- `reportError` / `reportEvent` mandan el detalle técnico a **Sentry** (elegido por su capa gratis:
  5k errores/mes, sin tarjeta — encaja con D-018). Se inicializa solo si `VITE_SENTRY_DSN` está
  presente (entorno de producción de Vercel); en local y en los tests no se activa.
- Cableado: los `catch` de onboarding, salir del hogar y regenerar código; el arranque de
  `main.tsx`; un parche que entra en cuarentena (`sync/quarantine.ts`); y un `Sentry.ErrorBoundary`
  alrededor de toda la app con `AppErrorFallback`.
- Source maps: `@sentry/vite-plugin` los sube desde el build de Vercel cuando hay `SENTRY_AUTH_TOKEN`.

**Pendiente / abierto** (issue #14):

- Reglas de alerta y scrubbing más fino en Sentry (por ahora solo `sendDefaultPii: false`).
- Mapear más códigos de PostgREST a mensajes propios. Hecho el de onboarding (commit `0c00be2`);
  faltan los demás (p. ej. el límite de intentos de `join_household` fuera del onboarding).

## 8. Volver a entrar a un hogar sin perder nada — issue #12

Surgió al definir multi-hogar (`plan_multi_hogar_y_copia_catalogo_v0.1.md`, §8). Hoy salir de un
hogar (`leave_household`) o ser expulsado al regenerar el código (D-040) borra la membresía. Volver a
entrar con el código crea una membresía nueva, pero:

- Si además reinstalaste la app, tu identidad anónima es otra (`estrategia_sincronizacion §7`): los
  cambios que tuvieras en cola sin enviar se pierden.
- Con multi-hogar, reinstalar obliga a reintroducir el código de **cada** hogar a mano; no hay
  "recuperar todos mis hogares". Se aceptó así para el MVP de multi-hogar, pero conviene resolverlo.

**Objetivo:** que quien salió o fue expulsado (y quizá reinstaló) pueda volver a entrar y quedar en
el mismo estado, sin datos huérfanos ni duplicados, "sin que nada cambie".

**Preguntas abiertas:**

- El catálogo y la lista se rebajan enteros del servidor al reentrar (ya pasa hoy), así que el único
  riesgo real es la **cola pendiente** atada a la identidad anónima vieja. ¿Basta con avisar de esos
  N cambios antes de reinstalar/salir, o hace falta más?
- ¿Un "código de recuperación" por dispositivo, aparte del código del hogar, que reasocie la
  identidad anónima nueva con la vieja?
- ¿La app guarda la lista de códigos de hogar en algún sitio que sobreviva a reinstalar (no
  `localStorage`), para reofrecerlos al volver?

## 9. Roles en el hogar: creador = admin — issue #13

Propuesta del usuario (2026-09-08) al definir multi-hogar: **quien crea el hogar es admin** y el
único que puede **regenerar el código** (D-014/D-040); el resto de miembros solo pueden **compartir**
el código existente.

**Reabre RN-009** (*"Ambos usuarios tienen los mismos permisos. No existen roles administrativos
diferentes en el MVP."*) y ARF §5.1. A resolver con cuidado antes de implementar:

- **Sin login, la identidad es el dispositivo.** Si el admin pierde el teléfono, nadie puede
  regenerar el código nunca más — y regenerar es la única mitigación de "quien tiene el código entra"
  (D-014). Hace falta traspaso de admin, o que otro miembro herede el rol bajo alguna condición
  (p. ej. el miembro más antiguo si el admin lleva X sin aparecer, o un traspaso explícito).
- ¿Qué pasa al salir el admin del hogar? ¿el rol pasa automáticamente al siguiente miembro?
- El rol es por `(hogar, usuario)`: encaja como columna `role` en `household_members`. Con multi-hogar
  una misma persona puede ser admin de un hogar y miembro raso de otro.
- Interacción con copiar catálogo (§2 / D-051): ¿copiar el catálogo de un hogar exige ser admin de
  él, o basta ser miembro (plan actual)?
- Beneficio secundario: reduce las expulsiones accidentales por regenerar, que es justo el problema
  que la "detección de expulsión" del plan de multi-hogar mitiga por el otro lado.

## 10. Filtro por categoría en la lista de Mercado — issue #15

El Catálogo ya tiene filtro por categoría: una fila de chips bajo el buscador, *single-select*,
aplicada en memoria sobre `liveProducts` (commit `3b04106`). La misma capacidad tiene sentido en la
lista de **Mercado**: con la compra a medias y una lista larga, poder ver solo "lo que falta de
Lácteos" mientras estás en ese pasillo.

El filtrado es una derivación en memoria sobre `list_items` (disciplina de las cuatro consultas), así
que es barato y funciona sin red. No añade consulta.

**Toca:**

- Un control de filtro en Mercado. La cabecera ya está en su tope de dos iconos (identidad_visual
  §5) y ya tiene el buscador desplegable, así que el filtro va dentro de ese panel o como fila de
  chips bajo la cabecera, no como icono nuevo.
- Reutilizar el componente y el patrón del filtro del Catálogo si encaja.

**Preguntas abiertas:**

- ¿Filtra a través de todas las secciones de supermercado a la vez, o por sección?
- ¿El filtro se recuerda entre visitas (`localStorage`, como conveniencia por dispositivo) o se
  reinicia al salir de Mercado?
- ¿Cómo convive con el orden por categoría que Mercado ya aplica dentro de cada supermercado (D-031)?
- ¿Una categoría a la vez (como el Catálogo) o varias?

## 11. Notificación push al finalizar una compra — issue #16

Cuando alguien finaliza una compra (por supermercado, D-001), avisar por **notificación push** a los
demás miembros del hogar: en qué supermercado se cerró y, si se anotó al cerrar, el total.

Caso: una persona hace la compra y la otra se entera al momento de que ya está hecha y cuánto costó,
sin abrir la app.

**Es una feature grande** y toca partes nuevas del stack. Necesita un spike o doc de diseño antes de
implementar:

- **Web Push en PWA de iOS.** Disponible desde iOS 16.4 solo con la PWA añadida a la pantalla de
  inicio y permiso concedido. Ambos usuarios están en iPhone (CLAUDE.md), así que es viable, pero hay
  que verificarlo en dispositivo real.
- **Sin coste (D-018).** Web Push con VAPID empuja directo al endpoint del navegador, sin FCM ni
  servicio de pago. El envío iría en una Edge Function de Supabase (capa gratis).
- **El disparo es server-side, no desde el cliente.** Finalizar es offline-capable y pasa por la
  cola (`sync_push`), así que el cliente puede estar sin red al cerrar. La notificación se dispara
  cuando el lote de compra (`purchase_batch_id`) aterriza en la base de datos: webhook o trigger
  sobre las lápidas de `list_items` con `removed_reason = 'purchased'`.
- **Tabla de suscripciones push** por dispositivo/usuario y hogar. Con multi-hogar, se notifica a los
  miembros de ese hogar concreto, nunca al que finalizó.
- **Idempotencia.** Finalizar se reintenta desde la cola; la notificación no puede salir dos veces
  (clave por `purchase_batch_id`).
- **Service worker**: manejadores `push` y `notificationclick` (el SW ya es obligatorio, D-018).
- **Tono** de la notificación: identidad_visual §8. Sin el total si no se anotó.

**Preguntas abiertas:**

- ¿Cuándo se pide el permiso de notificaciones: onboarding, primera finalización, un interruptor en
  Ajustes?
- ¿Disparo por webhook de base de datos, `pg_net` desde un trigger, o una Edge Function programada?
- Si alguien finaliza dos supermercados seguidos, ¿dos notificaciones o una agrupada?
- Si el destinatario no tiene la PWA instalada o no dio permiso, se degrada en silencio: ¿basta con
  eso o hace falta un aviso dentro de la app?
