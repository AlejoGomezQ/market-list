# Plan de implementación

**Versión:** 0.2
**Fecha:** 2026-09-06
**Depende de:** ARF, `decisiones_cerradas_v0.1.md`, `arquitectura_funcional_v0.1.md`,
`estrategia_sincronizacion_v0.1.md`, `experiencia_usuario_v0.1.md`, `identidad_visual_v0.1.md`.

Nueve fases, de la 0 a la 8, cada una con un criterio de "listo" comprobable. No hay fechas: no se ha
fijado cuánto tiempo por semana se le va a dedicar. El tamaño relativo va indicado como S, M o L.

> **v0.2** incorpora una revisión crítica del plan v0.1. Los cambios de fondo: la costura de datos
> deja de ser un principio y pasa a ser una fase propia con contenido concreto (fase 2a), porque lo
> irreversible no es dónde se llama sino qué se envía; `finish_purchase` desaparece; y la fase 5 se
> renombra a lo que realmente es.

---

## Dos principios que ordenan el plan

**Se despliega en el iPhone el primer día.** Todo el proyecto depende de cómo se comporte una PWA en
Safari, y descubrir en la semana cuatro que la barra inferior queda bajo el indicador de inicio es
carísimo. Desde la fase 0 hay una URL en Vercel abierta en el móvil real.

**Se construye en línea primero y se hace duradero después.** La capa offline es la parte con más
riesgo, y depurarla a la vez que el dominio es depurar dos incógnitas al mismo tiempo.

Eso solo es seguro si **la forma de las escrituras y de las consultas es la definitiva desde la fase
2a**. Una costura `mutate()` no basta por sí sola: protege el sitio desde donde se llama, pero lo
irreversible es el contenido. Concretamente, cuatro cosas no se pueden aplazar:

- **La forma del parche.** La unidad es `{entidad, id, ts, campos}`, con `ts` capturado en el momento
  en que el usuario actuó, no en el del envío. Escribir con mutaciones de dominio en las fases 3 y 4
  obligaría a reexpresarlas todas después.
- **Una sola mutación, no una por operación.** `scope` y `setMutationDefaults` son opciones de la
  definición de la mutación. Si hay veinte mutaciones, la fase 6 toca las veinte.
- **Las escrituras optimistas son requisito de las fases 3 y 4**, no de la 6. La interfaz tiene
  prohibido el indicador de carga en las acciones frecuentes (RNF-001); si las fases en línea esperan
  el ida y vuelta, se evalúan sobre una interfaz que no es la que se va a entregar.
- **Cuatro consultas persistidas, una por tabla, del hogar completo.** Todo filtro, orden,
  agrupación y búsqueda se deriva en memoria. Si el buscador se construye como consulta
  parametrizada, la caché se llena de entradas efímeras y deja de funcionar sin red.

---

## Fase 0 — Andamiaje y primer despliegue · S

- `git init` (el proyecto todavía no es un repositorio) y primer commit con la documentación.
- Vite con React y TypeScript, pnpm, Biome, Vitest.
- Tailwind con los tokens de `identidad_visual_v0.1.md` sustituyendo los de fábrica, y Archivo
  cargada con reserva de sistema.
- shadcn/ui instalado y su capa de tokens reemplazada (D-038).
- `vite-plugin-pwa` con **`registerType: 'prompt'`** desde el principio, no `autoUpdate`: si no, hay
  recargas por sorpresa durante toda la fase 4 (alta de cien productos) y la 6 (cola llena).
  Manifiesto, iconos, `viewport-fit=cover`, safe areas y `overscroll-behavior`.
- Workbox: sin ninguna regla de caché sobre el dominio de Supabase, que va en solo-red.
- TanStack Router con las dos pestañas y una pantalla de relleno cada una.
- Variables de entorno en Vercel (la clave anónima es pública y va protegida por RLS).
- CI en GitHub Actions ya: Biome, `tsc` y Vitest.

**Listo cuando:** la app está en la pantalla de inicio de los dos iPhone, abre en modo pantalla
completa, **abre también en modo avión** mostrando su armazón, y `navigator.storage.persist()`
devuelve concedido en modo instalado.

## Fase 1 — Datos y seguridad · M

Todo por migraciones versionadas del CLI de Supabase, desde el primer día.

- Las cinco tablas, con el índice único parcial de `list_items` y sin `default gen_random_uuid()`.
- Trigger `before update` que fuerce `updated_at = now()` en las cuatro tablas sincronizadas.
- `is_member()` como `security definer` y políticas RLS: lectura sí, `insert`/`update` directos **no**
  (D-039).
- `sync_push` con la fusión campo a campo, la distinción entre lápida absorbente y `removed_at`
  (§4.1 de la arquitectura), y la fusión de items por `product_id`.
- `create_household` y `join_household`, con limitación de intentos.
- Las cuatro tablas añadidas a la publicación `supabase_realtime`.
- `supabase gen types typescript` en un script de pnpm, y los esquemas Zod.
- **Dos proyectos:** uno local con Docker para desarrollo y uno remoto para uso real. Sin esa
  separación, un `supabase db reset` mal dirigido borra el catálogo de la casa.

**Listo cuando:** hay tests de integración contra Postgres que (a) demuestran que un hogar no puede
leer ni escribir en otro, y (b) aplican **C-001 a C-007 en los dos órdenes posibles** obteniendo el
mismo estado final. Incluye finalizar y deshacer, que es el par que el plan v0.1 no probaba y que
estaba roto.

Esta batería es lo único de este sistema que no se puede depurar mirando la pantalla, porque sus
fallos son silenciosos y diferidos. Va antes que una sola línea de interfaz.

## Fase 2a — La costura de datos · M

Sin interfaz. Es la fase de la que depende que el orden del resto no sea una reescritura.

- Un único `useSyncMutation` con `mutationKey: ['sync']`, `scope: {id:'sync'}`, registrada con
  `setMutationDefaults`, cuyo `mutationFn` envía un lote de parches a `sync_push`.
- Las cuatro consultas del hogar, con `gcTime: Infinity` y `shouldDehydrateQuery` ya decididos.
- Selectores en memoria: agrupación por supermercado, orden por categoría, búsqueda, items indexados
  por `product_id`.
- El reductor de filas remotas, uno solo, que descarta payloads más viejos que el estado local.
- Escrituras optimistas.

**Listo cuando:** los selectores y el reductor pasan tests unitarios, incluido el caso del eco de las
escrituras propias.

## Fase 2b — Hogar y vinculación · S

- Autenticación anónima, con la garantía de que un fallo de refresco sin red **no** se interpreta como
  cierre de sesión.
- Onboarding: crear hogar o unirse con código.
- Ajustes: código con copiar y regenerar, y la regeneración expulsando al resto de dispositivos
  (D-040).
- `navigator.storage.persist()` al vincular.

**Listo cuando:** los dos móviles están en el mismo hogar, reinstalar y volver a entrar con el código
recupera el acceso (D-014), y regenerar el código deja fuera al otro dispositivo.

## Fase 3 — Catálogo · M

- Supermercados: alta, edición, borrado con reasignación a "Sin asignar", color asignado.
- Categorías: siembra y administración desde Ajustes (D-041).
- Productos: alta con "Guardar y otro", selector de categoría plegado, edición, borrado con aviso,
  aviso de nombre parecido.
- Buscador y agrupación por supermercado, derivados en memoria.
- Export con `supabase db dump` en un script de pnpm, **antes** de cargar el catálogo real.
- Suelo de accesibilidad al escribir cada componente: foco visible, 44 px, contraste.

**Listo cuando:** el catálogo real de la casa está cargado, unos cien productos, desde el móvil, con
la mediana de tiempo por producto medida. Si supera los 15 segundos, el alta está mal diseñada y se
rediseña aquí.

## Fase 4 — Lista y compra · M

- Agregar y quitar, contador de cantidad, el control combinado de D-034.
- Buscador de la cabecera del Mercado con "crear y agregar" (D-008).
- Pantalla de Mercado con bandas de supermercado, plegado de secciones y orden por categoría.
- Marcar, con los comprados bajando al final.
- Finalizar por supermercado como lote de parches, con confirmación de dos cifras y deshacer.
- Realtime, **desechable a propósito**: invalidar y recargar, sin lógica de fusión en caché. En la
  fase 6 se sustituye por el reductor, porque una recarga es una lectura de red y la interfaz no lee
  de la red.

**Listo cuando:** se hace una compra real desde los dos móviles, con conexión, y además se comprueba
explícitamente que finalizar con items sin marcar los deja en la lista (RN-005), que finalizar Supermu
no toca D1 (D-001), que deshacer restaura exactamente el conjunto retirado (D-032) y que un producto
agregado por el otro durante la confirmación no entra en la finalización (C-002).

A partir de aquí la app ya sirve para algo.

## Fase 5 — Identidad visual · M

Sobre las pantallas reales, no sobre maquetas vacías.

- Paso de diseño con la guía `frontend-design`.
- Estados vacíos, textos definitivos, modo oscuro.
- El único momento con movimiento: la fila viajando al grupo de comprados.

**Listo cuando:** el suelo del §9 de `identidad_visual_v0.1.md` está verificado uno a uno: contraste
AA de los ocho colores de supermercado sobre texto blanco, foco visible en todo lo interactivo,
`prefers-reduced-motion` respetado, y la tipografía escalando al tamaño máximo del sistema sin romper
filas.

## Fase 6 — Durabilidad y recuperación · L

La fase con más riesgo, y por eso va sobre algo que ya funciona y cuya forma de escritura ya es la
definitiva.

- Persistidor de la caché en IndexedDB, con clave de versión de esquema.
- Cola de salida en su propio almacén, separada de la caché (D-030).
- Un solo lote por envío, backoff con tope de 60 s y jitter, clasificación de errores y cuarentena.
- Delta pull con cursor de servidor, en arranque, reconexión, vuelta a primer plano y reconexión de
  socket. Realtime pasa a usar el reductor de la fase 2a.
- Comprobación de sesión antes de drenar la cola.
- Indicador de estado de sincronización.

**Listo cuando:** (a) cerrar la app con la cola llena, reabrirla y comprobar que sube — el fallo
silencioso de `setMutationDefaults` es el riesgo principal de la fase y tiene que estar en el
criterio; (b) modo avión desde la pantalla de inicio, en cualquier sitio; (c) los dos dispositivos
sin conexión a la vez y reconciliando; (d) un parche en cuarentena que no bloquea el resto de la
cola.

## Fase 7 — Detalles finales · S

- Wake lock mientras haya pendientes en el Mercado.
- Aviso de versión nueva (la opción ya está puesta desde la fase 0; aquí se le pone interfaz).
- Playwright en CI con el escenario completo.

**Listo cuando:** CI pasa en verde con Biome, tipos, Vitest y Playwright.

## Fase 8 — Uso real · S

Tres compras de verdad sin tocar el código, apuntando la fricción. Corregir después, todo junto.

**Listo cuando:** la lista de fricción está escrita y priorizada, y decide qué de la V2 entra primero.

---

## Riesgos y cómo se atacan

| Riesgo | Mitigación |
|--------|-----------|
| Mutaciones rehidratadas sin `mutationFn`: cambios que se pierden en silencio | Está en el criterio de listo de la fase 6, no solo en esta tabla. |
| Safari purga el almacenamiento y se pierden cambios en cola | `persist()` concedido se verifica en la fase 0; la purga en sí solo se puede probar en la fase 6, cuando existe la cola. |
| RLS mal configurada: un hogar ve otro | Batería de la fase 1, antes de la interfaz. |
| Retrofit del local-first que obliga a reescribir | Fase 2a: la forma del parche y de las consultas es la definitiva desde el principio. |
| Cargar cien productos a mano es un muro | "Guardar y otro" y medición del tiempo por producto en la fase 3. |
| Un `db reset` borra el catálogo real | Proyecto de desarrollo separado (fase 1) y export antes de cargarlo (fase 3). |
| Supabase pausa el proyecto por inactividad | No es solo molestia: con el proyecto pausado falla el refresco del JWT en los dos móviles, y si coincide con semanas sin abrir se llega al único escenario donde se pierden cambios pendientes. Uso semanal real desde la fase 4. |
| Playwright no reproduce iOS | Ejecuta WebKit de escritorio: el desalojo, la congelación de pestaña y la muerte del socket hay que verlos en el teléfono. |

---

## Lo que este plan deja fuera a propósito

Todo lo excluido del MVP en el ARF, más las decisiones diferidas de la sección 6 de
`decisiones_cerradas_v0.1.md`: orden de recorrido por supermercado, sucursales e historial. También
la coalescencia de la cola y el inspector de cuarentena, que se retiraron por
sobredimensionados para dos usuarios. La fase 8 dirá qué pide sitio primero.
