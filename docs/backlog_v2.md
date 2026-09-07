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

## 5. Historial de compras

Consultar qué se compró y cuándo, en una lista que se repite. Es **barato**: D-026 ya guarda las
lápidas de `list_items` con `removed_at` y `removed_reason` (`'purchased'` frente a `'removed'`),
literalmente *"para sembrar el historial de V2 sin tabla adicional"*. Los datos ya se acumulan;
falta una vista de lectura.

**Toca / preguntas abiertas:**

- Hoy finalizar una compra **no agrupa los items en una entidad "compra"**: quedan lápidas sueltas
  con `removed_at` cercanos. Para un historial limpio (y para el total del punto 6) probablemente
  haga falta un id de compra/lote que se escriba al finalizar.
- Pantalla o sección nueva: queda fuera de las dos pestañas actuales (Mercado/Catálogo), es una
  decisión de navegación.
- Habilita más adelante las sugerencias automáticas ("no compras café hace tres semanas").

## 6. Total gastado por compra

Al finalizar una compra (el drawer de confirmación en `src/routes/mercado-screen.tsx`), un campo
**opcional** para escribir el **total gastado** en esa compra. Un solo número por compra, no
precios por producto — así se evita la fricción de captura que dejó "precios" fuera del MVP. En el
historial (punto 5), cada compra muestra su total, lo que permite llevar cuentas básicas (gasto por
mes, por supermercado).

**Toca / preguntas abiertas:**

- Depende del punto 5 y del id de compra/lote que ese necesita: el total cuelga de la "compra", no
  de los items.
- El campo es opcional: finalizar sigue funcionando sin escribir nada (D-001, finalizar no se
  bloquea).
- Una sola moneda, la del hogar, sin conversión. ¿Editable después desde el historial?
