# Backlog de V2

**Versión:** 0.1
**Fecha:** 2026-09-07

Ideas que han surgido usando la app de verdad (Fase 8 del plan de implementación). **No están
decididas ni priorizadas**: la Fase 8 termina eligiendo cuáles entran primero. Este documento
complementa lo que ya se dejó fuera a propósito en `decisiones_cerradas_v0.1.md` §6 y en el ARF
(historial, precios, estadísticas, sugerencias automáticas, ubicación/GPS), que sigue siendo la
lista canónica de lo descartado.

---

## 1. Pertenecer a más de un hogar y cambiar entre ellos

Hoy un dispositivo pertenece a **un solo hogar**: `src/lib/household-link.ts` guarda un único
vínculo en `localStorage`, y `regenerate_household_code` / `leave_household` derivan el hogar del
llamador con `where user_id = auth.uid()` sin recibir un `household_id`. El modelo de datos
(`household_members`) ya admite que un mismo usuario anónimo sea miembro de varios hogares; el
trabajo es de cliente y de firmas de RPC, no de esquema.

**Toca:**

- El vínculo local pasa a ser una **lista** de hogares más cuál está activo.
- Un **selector de hogar** (¿en Ajustes? ¿en la cabecera de Mercado?). El onboarding deja de ser
  solo "crear o unirse" y suma "añadir otro hogar" para quien ya tiene uno.
- Las cuatro consultas persistidas ya llevan `householdId` en la clave, así que las cachés por
  hogar salen casi gratis. El motor de sincronización (`src/lib/sync/engine.ts`, `realtime.ts`)
  tiene que decidir si opera solo sobre el hogar activo o sobre todos a la vez.
- `regenerate_household_code` y `leave_household` reciben un `household_id` explícito (hoy asumen
  uno solo).

## 2. Copiar el catálogo de productos de un hogar a otro

Caso: una familia nueva quiere **partir del catálogo de otro hogar** en vez de dar de alta ~100
productos a mano. Se copian los productos —y, si se decide, las categorías y supermercados a los
que apuntan— con identificadores nuevos (`crypto.randomUUID()`, D-024), remapeando `category_id` y
`supermarket_id`. No se copian los items de lista (son de la ocasión, no del catálogo) ni las
lápidas.

**Preguntas abiertas:**

- ¿Una RPC `copy_catalog(origen, destino)` con `is_member()` sobre ambos hogares (una sola
  transacción), o el cliente hace las escrituras por `sync_push` (respeta la costura, pero son
  cien y pico parches)?
- ¿Se copian solo productos, o también las categorías y los supermercados propios del origen?
- Depende de poder introducir el código del hogar origen (relacionado con el punto 1).

## 3. Compartir la lista de un supermercado a WhatsApp

Caso: mandar "lo que falta de Supermu" a alguien que va a hacer la compra y **no tiene la app**.

Solo lectura, sin backend: `navigator.share()` (Web Share API, disponible en Safari iOS y en la
PWA instalada) con un texto plano generado —nombre del supermercado y los productos pendientes, con
la cantidad solo si es mayor que 1 (identidad_visual §4)—. Fallback a copiar al portapapeles si
`share` no está disponible.

**Preguntas abiertas:**

- ¿Desde dónde se dispara? Un icono de compartir en la banda del supermercado en Mercado, o en el
  drawer de finalizar compra. Cuidar el "pocos iconos" de identidad_visual §5.
- Formato del texto: agrupado o plano, con o sin la marca. El texto compartido también sigue el
  tono de identidad_visual §8.

## 4. Orden de recorrido propio por supermercado (RF-021)

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

**Pregunta abierta pendiente:**

- **Total editable desde el Historial.** Hoy el total solo se escribe al finalizar y el Historial es
  de solo lectura (YAGNI). Editarlo después (corregir una cifra mal tecleada, o añadirla a una
  compra que se cerró sin total) es la extensión natural.

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

**Pendiente / abierto:**

- Reglas de alerta y scrubbing más fino en Sentry (por ahora solo `sendDefaultPii: false`).
- Mapear códigos concretos de PostgREST (p. ej. el límite de intentos de `join_household`) a
  mensajes propios; hoy caen al genérico.

## 8. Volver a entrar a un hogar sin perder nada

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

## 9. Roles en el hogar: creador = admin

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
