# Decisiones cerradas

**Versión:** 0.1
**Fecha:** 2026-09-06
**Relación con el ARF:** cierra las decisiones abiertas de la sección 14 de
`analisis_requerimientos_funcionales_app_mercado_v0.1.md` y añade algunas que el ARF no contemplaba.

Este documento es la entrada a la fase de definición de arquitectura funcional, experiencia de
usuario, estrategia de sincronización y stack. Las decisiones marcadas como *propuesta aceptada por
omisión* fueron recomendaciones no objetadas por el usuario y pueden revisarse.

---

## 1. Producto y modelo de dominio

### D-001 — Finalizar compra es por supermercado

Cada grupo de supermercado se cierra de forma independiente: se puede terminar Supermu el martes y
D1 el sábado sin que uno afecte al otro. El botón de cierre vive en la cabecera de cada sección.

Consecuencia: la finalización se acota a un **conjunto explícito de items** (los que estaban
marcados al pulsar), no a "todo lo marcado en este instante". Esto es lo que hace determinista el
conflicto C-002.

*Cierra la ambigüedad de RF-017, que el ARF no resolvía.*

### D-002 — El supermercado del producto es opcional

Un producto puede no tener supermercado asignado y aparece en un grupo **"Sin asignar"**, siempre al
final de la lista. Eliminar un supermercado deja de ser una operación destructiva: sus productos
caen en ese grupo.

*Cierra la decisión abierta #5 y relaja el mínimo obligatorio de RF-001.*

### D-003 — El item de lista es una entidad propia

No se modela como un campo `en_lista` sobre el producto. Motivos: mantiene el estado transitorio
fuera del catálogo, simplifica la resolución de conflictos y habilita el historial de V2 sin
migración de datos (RNF-006).

*Propuesta aceptada por omisión.*

### D-004 — Las categorías son entidades del hogar

Editables, con identidad y orden propios, sembradas con el conjunto inicial de RF-020. La identidad
es requisito para el orden de recorrido por supermercado de RF-021. La categoría es opcional en el
producto.

*Propuesta aceptada por omisión.*

### D-005 — La marca pertenece al producto

No se puede sobreescribir por compra concreta, tal como establece RF-012.

### D-006 — Duplicados: avisar sin bloquear

Al crear un producto de nombre similar a uno existente, la app avisa pero permite continuar. Evita
que el catálogo degenere en "Leche" / "leche" / "Leche Alpina" sin imponer una validación rígida.

*Propuesta aceptada por omisión. No estaba en el ARF.*

---

## 2. Experiencia de usuario

### D-007 — Lista continua con secciones, no pestañas

El hogar usa **dos supermercados** (Supermu y D1). Con esa cantidad, una lista continua con una
sección por supermercado se abarca de un vistazo y las pestañas añaden un toque sin aportar nada.

*Cierra UX-001 y la decisión abierta #1. Revisar si el número de supermercados crece.*

### D-008 — Crear y agregar en un solo gesto

Existe un atajo para crear un producto directamente desde la lista de mercado, cubriendo el caso de
acordarse de algo que no está en el catálogo. No sustituye al alta normal desde el catálogo: RF-009
sigue siendo una acción distinta de RF-001.

*Propuesta aceptada por omisión. No estaba en el ARF.*

### D-009 — Al marcar, el producto se tacha y baja al final de su sección

No desaparece (lo prohíbe RF-015), pero la lista de pendientes se acorta visualmente conforme
avanza la compra.

*Propuesta aceptada por omisión. Cierra parte de UX-004.*

### D-010 — Cantidad: contador simple

Control `− 1 +`, valor por defecto 1, sin unidad de medida en el MVP. Al volver a agregar un
producto que salió de la lista, la cantidad vuelve a 1 y no recuerda la anterior.

*Cierra UX-003 y la decisión abierta #6.*

### D-011 — Buscador en el catálogo

Búsqueda por nombre y agrupación por supermercado. Con el volumen esperado (del orden de cien
productos) el catálogo es inmanejable sin ella.

*Propuesta aceptada por omisión. No estaba en el ARF.*

### D-012 — Indicador de estado offline

La interfaz señala cuándo no hay conexión y cuándo quedan cambios pendientes de subir.

*Propuesta aceptada por omisión.*

### D-013 — Sin notificaciones push en el MVP

Coherente con la exclusión de "notificaciones avanzadas" del alcance inicial.

---

## 3. Vinculación del hogar

### D-014 — Código permanente, reutilizable y regenerable

El código del hogar no caduca, se muestra siempre en ajustes y sirve para dos cosas: unir el segundo
dispositivo y **recuperar el hogar tras reinstalar la app o cambiar de teléfono**. Sin login
tradicional, esta es la única vía de recuperación, y el ARF no la contemplaba.

Contrapartida asumida: quien tenga el código entra. Se mitiga permitiendo **regenerarlo**, lo que
invalida el anterior.

*Cierra la decisión abierta #8 y un hueco no cubierto por el ARF.*

---

## 4. Sincronización

### D-015 — Ventana offline de minutos a horas

El escenario real es estar dentro de un supermercado sin cobertura, no pasar días desconectado. Esto
descarta estructuras tipo CRDT y hace suficiente el último-en-escribir-gana.

*Cierra la decisión abierta #7 en su dimensión de alcance.*

### D-016 — Réplica local completa

Se replica localmente todo el hogar, sin selectividad. El volumen es de cientos de registros.

*Cierra la decisión abierta #9.*

### D-017 — Último en escribir gana, campo a campo

La resolución se aplica por campo y no por documento completo, de modo que dos ediciones simultáneas
sobre atributos distintos del mismo producto no se pisen. La cola de mutaciones envía solo los
campos modificados.

### Política de conflictos

| Id | Escenario | Resolución |
|----|-----------|------------|
| C-001 | A marca un producto como comprado mientras B lo quita de la lista | Gana quitarlo. El marcado es un estado *dentro* del item; si el item desaparece, no hay nada que marcar. |
| C-002 | A finaliza la compra mientras B agrega productos | La finalización solo afecta a los items marcados en el momento de pulsar (ver D-001). Lo agregado después sobrevive. |
| C-003 | Ambos editan el mismo producto sin conexión | Último en escribir gana, campo a campo (D-017). |
| C-004 | A elimina un producto del catálogo mientras B lo agrega a la lista | Gana el borrado; el item se descarta. Al eliminar un producto que está en la lista, la app avisa antes. |
| C-005 | Los dos agregan el mismo producto a la lista casi a la vez | Se funden en un único item activo. Agregar declara una intención, no crea una fila; el cliente indexa los items por `product_id`, que es su clave natural. |
| C-006 | A finaliza la compra y deshace; B ha tocado esos items mientras tanto | `removed_at` de `list_items` es un campo normal sujeto a último-en-escribir-gana, no una lápida absorbente. Un parche que solo toca `checked` sobre un item retirado se descarta (C-001); uno que toca `removed_at` se aplica por marca de tiempo. |
| C-007 | A borra un supermercado mientras B asigna un producto a él | El producto queda apuntando a un supermercado borrado y se pinta en "Sin asignar". Regla de pintado, no de datos. |

*Cierra la decisión abierta #7 en su dimensión de comportamiento.*

C-005 y C-006 salieron de una revisión del plan, no del ARF. C-005 era el escenario más probable de
todos y habría acabado en cuarentena visible; C-006 hacía literalmente imposible el deshacer de
D-032, porque la regla original ("una lápida nunca resucita") descartaba su parche en silencio.

---

## 5. Stack

### D-018 — Aplicación web instalable (PWA)

Se distribuye como una URL que se abre en Safari y puede añadirse a la pantalla de inicio. No pasa
por la App Store.

Motivo: el desarrollo es en Windows y el presupuesto es cero, lo que descarta una app nativa (exige
el Apple Developer Program, 99 USD/año, y en la práctica un Mac).

El *service worker* **no es opcional**: sin él la app no carga al abrirse sin conexión y RF-024 y
RNF-003 quedan incumplidos. Riesgo residual asumido: si no se añade a la pantalla de inicio, Safari
purga el almacenamiento local con más agresividad; como la fuente de verdad está en el servidor, lo
único expuesto son los cambios offline aún no sincronizados.

### D-019 — Supabase como backend

Elegido por el usuario sobre la alternativa de Firebase, por preferencia y escalabilidad percibida.

Consecuencias que hay que asumir en el diseño técnico:

- **El offline se construye a mano.** Supabase no trae persistencia offline de serie. Hace falta un
  almacén local (IndexedDB) como fuente de verdad de la interfaz, más una cola de mutaciones
  pendientes que se reenvía al reconectar.
- **Supabase Realtime** cubre el requisito de reactividad entre dispositivos (RF-016).
- **A favor:** las funciones en Postgres son gratuitas, así que la unión al hogar por código se
  resuelve con una función del servidor. En Firebase habría habido que apañarlo solo con reglas de
  seguridad, porque las Cloud Functions exigen plan de pago.
- **Nota operativa:** el plan gratuito pausa proyectos tras un periodo largo de inactividad. Con uso
  semanal no debería ocurrir; si ocurre, se reactiva desde el panel.

### D-020 — Autenticación anónima

Sin usuario ni contraseña (RF-022). Cada dispositivo obtiene una identidad anónima que se asocia al
hogar mediante el código de D-014.

---

### D-021 — Vite + React + TanStack Router, no Next.js

Se descarta Next.js. El razonamiento original ("Next para desplegar fácil en Vercel") parte de una
premisa falsa: Vercel despliega una SPA de Vite con configuración cero y en el mismo plan gratuito.

Contra Next pesa que el App Router es servidor-céntrico y va a buscar cargas RSC al navegar, lo que
rompe sin conexión salvo precacheo agresivo, y que `next-pwa` está sin mantenimiento. La salida sería
el export estático, pero eso renuncia a server actions, route handlers y middleware, es decir, a todo
aquello por lo que se elige Next: su complejidad sin sus ventajas.

A favor de Vite: `vite-plugin-pwa` es de primera clase y el offline deja de ser la excepción.
Aquí no hay SEO que ganar (app privada de dos personas), no hay carga inicial que optimizar con SSR
(el dataset vive en local) y la sesión de Supabase es anónima y de cliente.

### D-022 — TanStack Query persistido como capa offline

`persistQueryClient` sobre IndexedDB, más mutaciones pausadas que se reanudan al recuperar la red.
Cubre la ventana de minutos u horas de D-015 con mucho menos código propio que una bandeja de salida
a mano.

Condición para que funcione: **las mutaciones deben ser idempotentes y con claves estables**, o al
reconectar se duplican items. Es lo que justifica los identificadores de cliente (D-024) y la fusión
por campo en servidor (D-025).

### D-023 — Zod, shadcn/ui y el resto del tooling

- **Zod** valida en tres fronteras, no solo en formularios: lo que llega por Realtime (viene de otro
  dispositivo), lo que sale de IndexedDB (el esquema local envejece entre despliegues) y la entrada
  de usuario. Se complementa con `supabase gen types typescript` para los tipos de tablas.
- **shadcn/ui**, con la salvedad de que es Radix pensado para ratón: la app se usa con una mano en un
  pasillo, así que mínimo 44 px de área de toque y *drawer* (vaul) en vez de *dialog* para lo que se
  abra desde abajo.
- **TanStack Table queda descartada**: no hay ninguna tabla, hay dos listas en un móvil.
- Resto: pnpm, Vitest para la lógica de fusión y colas, Playwright para el flujo offline crítico,
  **Biome** en lugar de ESLint más Prettier, y GitHub Actions para CI.
- El plan gratuito de Supabase no da retención larga de copias: hace falta un export periódico de los
  datos del hogar, aunque sea manual.

### D-024 — Los identificadores se generan en el cliente

`crypto.randomUUID()` en el momento de crear la entidad, sin esperar al servidor. Sin esto no hay
creación offline posible, y además convierte cada inserción en un *upsert* idempotente, que es lo que
hace segura la reanudación de mutaciones de D-022.

### D-025 — La fusión por campo ocurre en el servidor

Cada fila lleva una columna `field_updated_at` (jsonb) con la marca de tiempo de cada campo. Las
escrituras pasan por una función de Postgres que aplica campo a campo solo lo más reciente.

Esto hace el resultado **independiente del orden de llegada** y las reescrituras **idempotentes**:
reenviar una mutación pendiente dos veces produce el mismo estado. Es la pieza que sostiene D-017 y
la que permite que la cola de salida reintente sin miedo.

Detalle a cuidar: el reloj del cliente puede estar mal, y con último-en-escribir-gana un dispositivo
adelantado ganaría siempre. La marca de tiempo del cliente se acota al `now()` del servidor.

### D-026 — Borrado lógico con lápidas

Los borrados no eliminan la fila: marcan `deleted_at` (o `removed_at` en los items de lista). Un
dispositivo que estaba sin conexión nunca se entera de una fila que simplemente desapareció, así que
la lápida es un requisito de la sincronización, no una papelera.

Para el usuario el borrado sigue siendo definitivo y sin recuperación, tal como pide RF-003: la
lápida es invisible en la interfaz.

Efecto secundario aprovechable: un item retirado guarda **por qué** salió de la lista (`purchased` o
`removed`), lo que siembra gratis el historial de V2 sin crear ninguna tabla adicional.

### D-027 — El supermercado del item se deriva del producto

Los items de lista no copian el supermercado: lo leen del producto en cada render. Si cambias el
supermercado habitual de un producto que está en la lista, el item se mueve de sección al instante.

RF-008 dice que el cambio "se reflejará en las futuras listas" y no aclara qué pasa con la actual.
Se resuelve así porque es el comportamiento menos sorprendente (si te das cuenta en el pasillo de que
el arroz sale mejor en el otro súper, quieres que se mueva ya) y porque evita mantener un dato
duplicado que puede quedar obsoleto.

### D-028 — Realtime nunca es la fuente de verdad

Realtime aporta la latencia baja de RF-016, pero no reproduce lo ocurrido mientras el socket estaba
caído. Confiar solo en él deja un agujero permanente en el estado local tras cada desconexión.

Siempre hay un *delta pull* por cursor al arrancar, al recuperar la red, al volver la pestaña a
primer plano y al reconectar el socket.

### D-029 — Sin sincronización en segundo plano

iOS no soporta la Background Sync API, así que la cola de salida solo sube con la app abierta. Cerrar
la pestaña con cambios pendientes los deja pendientes hasta la próxima apertura.

Es una limitación asumida, no un fallo. Obliga a que el contador de cambios pendientes sea visible
**antes** de cerrar la app, no solo al abrirla.

### D-030 — La caché es desechable, la cola de salida no

Viven en almacenes de IndexedDB separados y con versionado independiente. La caché de consultas se
tira entera ante cualquier duda y se rehace con un bootstrap; la cola contiene los únicos datos que
no existen en ningún otro sitio y una subida de versión del esquema no puede llevársela por delante.

### D-031 — Dentro de cada supermercado, los items se ordenan por categoría

Se usa el orden global de `categories.position`, igual para todos los supermercados. Los productos
sin categoría van al final del grupo.

Es lo que hace que las categorías ganen su sitio ya en el MVP en lugar de ser un campo que nadie
rellena: agrupa lácteos con lácteos y limpieza con limpieza, que es aproximadamente cómo está
distribuida una tienda. El recorrido propio de cada supermercado (RF-021) sustituirá este orden en V2
sin cambiar nada más de la interfaz.

### D-032 — Finalizar compra ofrece deshacer

Tras finalizar, un aviso al pie durante unos segundos permite revertir la operación.

Sale prácticamente gratis: como el retirado es lógico y no físico (D-026), deshacer consiste en poner
a nulo el `removed_at` de esos items. Sin él, una compra finalizada por error obliga a reconstruir la
lista a mano producto por producto, que es el peor momento posible para pedirle paciencia a alguien
que acaba de llegar a casa con las bolsas.

### D-033 — Dos pestañas: Mercado y Catálogo

La navegación raíz son dos pestañas en la barra inferior, y **Mercado es la pantalla de arranque**
porque es la que se abre dentro del supermercado. Ajustes no ocupa pestaña: vive tras un icono en la
cabecera del Catálogo.

La estructura sale de que hay dos momentos de uso muy distintos: armar la lista en casa (Catálogo) y
marcar en el pasillo (Mercado).

### D-034 — Agregar y fijar cantidad son el mismo control

En el catálogo, un producto fuera de la lista muestra `+`; al tocarlo entra con cantidad 1 y el botón
se convierte en el contador `− 1 +`, de modo que el segundo toque ya sube a 2.

Cierra UX-002 y UX-003 a la vez, con un solo control y sin abrir ninguna pantalla intermedia. Quitar
de la lista es bajar el contador a cero.

### D-035 — Nada de emojis en la interfaz

Instrucción explícita del usuario. Los iconos vienen de Lucide, con grosor de trazo definido, tamaño
alineado a la rejilla tipográfica y `currentColor`. Además de la razón estética hay una funcional: un
emoji se dibuja distinto en cada sistema, no hereda el color del texto y no se alinea con la
tipografía.

Se aplica también a las maquetas en texto de esta documentación.

### D-036 — El color pertenece a los supermercados

La interfaz es acromática: negro, blanco y grises. El único color saturado de la pantalla es el que
identifica a cada supermercado, asignado al crearlo de una paleta cerrada de ocho.

Así el color hace un trabajo en vez de decorar: sirve para saber en qué sección estás sin leer, que
es exactamente lo que hace falta en un pasillo. Los colores de estado (sin conexión, eliminar) son
deliberadamente menos vivos, para que un aviso no grite más que la orientación.

### D-037 — Una sola familia tipográfica, Archivo, con eje de anchura

Los dos registros de la interfaz (señalización y contenido) se distinguen por **anchura**, no por
cambiar de tipografía. Archivo está dibujada para aguantar tamaños pequeños y titulares de alto
rendimiento, que es lo que pide leer en movimiento.

Las únicas mayúsculas de la interfaz son las del rótulo de supermercado, porque ahí son señalización.
No hay antetítulos ni etiquetas en versalitas espaciadas en ninguna otra parte.

### D-038 — shadcn/ui aporta comportamiento, no aspecto

Se aprovechan su accesibilidad, foco, manejo de teclado y el comportamiento del *drawer*, y se
sustituye entera su capa de tokens. No se usa `Card` para las filas de lista, ni el radio uniforme por
defecto, ni la sombra gris bajo cada bloque. Dejar los valores de fábrica es lo que hace que dos
aplicaciones distintas parezcan la misma.

El detalle completo está en `identidad_visual_v0.1.md`.

### D-039 — Solo se escribe a través de `sync_push`

Las políticas RLS conceden lectura, pero no `insert` ni `update` directos sobre las tablas. Toda
escritura pasa por la función de fusión, incluida la finalización de compra, que deja de tener
función propia y pasa a ser un lote de parches.

Convierte la disciplina de "un solo camino de escritura" en una restricción del servidor en lugar de
un acuerdo que hay que recordar. Y elimina el segundo camino que tenía la finalización, que se pulsa
en la fila de la caja, donde peor va la cobertura, y que por tanto necesita la cola como cualquier
otra operación.

### D-040 — Regenerar el código expulsa a los demás dispositivos

Regenerar el código del hogar (D-014) elimina también las membresías distintas de la que ejecuta la
acción, y obliga al otro dispositivo a volver a entrar con el código nuevo.

Sin esto, la regeneración no mitigaba nada: quien ya se hubiera unido conservaba su acceso para
siempre, así que ante el escenario real que justificaba la medida (un teléfono perdido o robado)
cambiar el código era puramente cosmético.

### D-041 — Las categorías se administran desde Ajustes ya en el MVP

Había una contradicción entre documentos: la sección 6 difería la administración de categorías a V2,
mientras que la pantalla de Ajustes ya las listaba. Manda la segunda.

El alcance es deliberadamente pequeño: crear, renombrar, borrar y reordenar la lista global. Lo que
sigue diferido a V2 es el **orden de recorrido propio de cada supermercado** (RF-021), que es otra
cosa. Como el orden global de categorías es lo que ordena los items dentro de cada supermercado
(D-031), no poder tocarlo dejaría al usuario atado a una siembra inicial que casi con seguridad no
coincide con su tienda.

### D-042 — Tres pestañas: Mercado, Catálogo e Historial

Revierte parcialmente D-033: la barra inferior pasa de dos pestañas a tres, sumando **Historial**.
Mercado sigue siendo la pantalla de arranque y Ajustes sigue sin ocupar pestaña.

El historial de compras (backlog_v2 §5 y §6) es una vista de solo lectura sobre las lápidas que ya
guarda `list_items` (`removed_reason = 'purchased'`, D-026). No cabe como sub-sección de Mercado ni
de Catálogo sin fricción: Mercado es "lo que falta ahora" y no admite un tercer modo sin un toque
extra en el peor momento (el pasillo), y Catálogo es el inventario permanente, no un registro
temporal. El uso real de la Fase 8 pidió consultarlo de un vistazo, así que gana su propia pestaña.

Es una pestaña de consulta ocasional, no de las de "un toque en el pasillo", pero tampoco se visita
tres veces al año como Ajustes: vive en la barra, no tras un icono. No añade una quinta consulta
persistida — se deriva en memoria de `list_items` con el resto.

Nada de esto bloquea la fase de definición:

- Orden de recorrido por supermercado (RF-021): el modelo debe soportarlo, la edición es posterior.
- Sucursales de un mismo supermercado (decisión abierta #4): el modelo debe dejar sitio, no se
  implementa.
- Administración de categorías por parte del usuario (UX-005): se siembran, se editan más adelante.
- Historial, precios, estadísticas y ubicación: fuera del MVP por decisión del ARF.

---

## 6. Multi-hogar y copia de catálogo (V2)

Cierran `backlog_v2.md` §1 y §2. El diseño completo y el porqué de cada una están en
`plan_multi_hogar_y_copia_catalogo_v0.1.md`; aquí queda solo el enunciado canónico. Implementadas en
la rama `feature/multi-hogar-y-copia-catalogo`. Fecha: 2026-09-08.

### D-043 — Un dispositivo puede pertenecer a varios hogares; el "hogar activo" es local

El vínculo de `localStorage` pasa de un objeto único a `{ households: HouseholdLink[], activeId }`.
El hogar activo **no se sincroniza**: cada dispositivo, incluidos los dos de una misma persona, elige
el suyo. No hay columna ni tabla de servidor para esto. El esquema `household_members` (PK
`(household_id, user_id)` sin `unique(user_id)`) ya lo permitía; el trabajo fue de cliente y de
firmas de RPC.

### D-044 — La sincronización opera solo sobre el hogar activo

Realtime, delta pull y la cola trabajan únicamente sobre el hogar activo (amplía D-029). Cambiar de
hogar **recarga la app** (`window.location.assign`), como ya hacía salir de un hogar. El cursor del
delta pull pasa a llevar el `householdId` en la clave (`sync:cursor:<householdId>:<entity>`): sin
esto, cambiar de hogar reutiliza el cursor del anterior y se salta filas en silencio.

### D-045 — El selector de hogar vive en Ajustes, como primera sección

No va en la cabecera de Mercado: rompería el contrato del `<h1>Mercado</h1>` de los tests y choca con
"lo que está arriba del todo es para mirar, no para tocar" (`experiencia_usuario` §1). Se revisará en
Fase 8 si el uso muestra que se cambia de hogar a menudo.

### D-046 — "Añadir otro hogar" reutiliza la pantalla de onboarding

Desde Ajustes se navega a `/onboarding?add=true`. El guardia de onboarding deja pasar en ese modo
aunque ya haya vínculo; la copia cambia a "Añadir otro hogar", aparece un botón "Cancelar" visible
(en pantalla completa no hay botón de atrás), y al terminar el hogar nuevo queda activo y la app
recarga.

### D-047 — Salir de un hogar con otros pendientes hace limpieza selectiva

Si quedan otros hogares, salir elimina solo las 4 consultas y los 4 cursores de ese hogar
(`clearHouseholdSyncState`) y promueve otro activo. Si era el último, comportamiento anterior
(`clearPersistedSyncState` global + volver a onboarding). La cola no se segmenta por hogar: un parche
huérfano del hogar abandonado, caso raro, acabaría en cuarentena con aviso legible.

### D-048 — `regenerate_household_code` y `leave_household` reciben `p_household_id`

Dejan de derivar el hogar de `auth.uid()` (con `limit 1` sin orden, o borrando todas las
membresías). Reciben el id explícito y validan `is_member`. La expulsión de D-040 queda acotada a ese
hogar.

### D-049 — Copiar catálogo es una RPC transaccional, excepción acotada a D-039

`copy_catalog(origen, destino, copiar_supermercados, copiar_categorias)`, `security definer`, con
`is_member` sobre **ambos** hogares, todo en una transacción. Es una excepción deliberada a "un solo
camino de escritura": operación administrativa, en línea, no frecuente, que debe ser atómica, con el
mismo precedente que la siembra de categorías de `create_household`. No se hace con ~100 parches por
`sync_push`.

### D-050 — Qué copia `copy_catalog` y cómo resuelve duplicados

Copia productos activos del origen y, según los dos flags, sus categorías y supermercados.
Categorías y supermercados se emparejan con los del destino por `lower(btrim(name))`; los que no
existan se crean con id nuevo. Un producto cuyo `(nombre, marca)` ya exista activo en el destino se
omite — resuelve D-006 en masa. No copia items de lista ni lápidas. Ejecutarla dos veces seguidas es
un no-op.

### D-051 — Para copiar de un hogar hay que ser miembro de él

`copy_catalog` exige `is_member` sobre origen y destino. La feature de copia **no tiene entrada de
código propia**: se apoya en "añadir otro hogar" (D-046) para eso, y solo añade un selector de origen
entre los hogares del dispositivo y la llamada a la RPC. Copiar es una acción en línea; su botón se
desactiva sin conexión. No se ofrece salir del hogar de origen tras copiar: se hace a mano desde
Ajustes.

### D-052 — Color de los supermercados copiados

No hay columna de color: el color se deriva del orden `position` de cada supermercado en el cliente
(D-036, `identidad_visual` §2). Así que "asignar el siguiente color libre" a un supermercado copiado
se reduce a añadirlo al final (`position = max + 1`) del hogar destino; el color sale solo.

### D-053 — `list_households()` es la fuente de verdad del selector

RPC que devuelve las membresías del llamador (`{ household_id, name, join_code }`). El selector de
Ajustes la usa para mostrar la verdad y podar los hogares de los que se expulsó al dispositivo
(D-040/D-048), con aviso. El vínculo local sigue bastando para el camino feliz y para arrancar sin
red.

### Lo que queda para más adelante

`backlog_v2.md` §8 (volver a entrar a un hogar sin perder nada, tras salir, ser expulsado o
reinstalar) y §9 (roles: el creador del hogar como único que puede regenerar el código, que reabre
RN-009). Son ortogonales a multi-hogar y no lo bloquean.
