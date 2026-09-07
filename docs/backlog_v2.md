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
