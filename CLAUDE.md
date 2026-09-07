# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado del repositorio

El proyecto está en fase **pre-implementación**: no hay código, ni gestor de paquetes, ni suite de pruebas, ni repositorio git inicializado. Todo el contenido vive en `docs/`:

- `analisis_requerimientos_funcionales_app_mercado_v0.1.md` — ARF v0.1, la definición funcional.
- `decisiones_cerradas_v0.1.md` — las decisiones `D-0xx` que cierran la sección 14 del ARF y fijan stack, UX y sincronización. **Leerlo siempre junto al ARF**: es lo que resuelve las ambigüedades que el ARF deja abiertas.
- `arquitectura_funcional_v0.1.md` — modelo de datos, operaciones del dominio, fusión de escrituras y seguridad.
- `estrategia_sincronizacion_v0.1.md` — cola de salida, reintentos, bajada de cambios, sesión offline y almacenamiento local.
- `experiencia_usuario_v0.1.md` — pantallas, navegación, gestos y particularidades de la PWA en iOS.
- `identidad_visual_v0.1.md` — paleta, tipografía, retícula, movimiento y tono de los textos.
- `plan_implementacion_v0.1.md` — las ocho fases, su criterio de "listo" y los riesgos.

**Disciplina que sostiene el plan.** Se construye en línea primero y se hace duradero en la fase 6. Eso solo funciona si la forma de las escrituras y las consultas es la definitiva desde la fase 2a — la costura protege el sitio desde donde se llama, pero lo irreversible es el contenido:

- **Una sola mutación** (`mutationKey: ['sync']`, `scope: {id:'sync'}`, registrada con `setMutationDefaults`), no una por operación. `scope` y los defaults son opciones de la definición, así que veinte mutaciones son veinte sitios que tocar después.
- **La unidad es el parche** `{entidad, id, ts, campos}`, con `ts` del momento en que el usuario actuó, no del envío.
- **Cuatro consultas persistidas**, una por tabla, del hogar completo, con `gcTime: Infinity`. Todo filtro, orden, agrupación y búsqueda se deriva en memoria. Una búsqueda como consulta parametrizada llena la caché de entradas efímeras y deja de funcionar sin red.
- **Escrituras optimistas desde las fases en línea**, no al final: RNF-001 prohíbe el indicador de carga en acciones frecuentes.
- **Los items de lista se indexan por `product_id`**, no por su id: el dominio garantiza uno activo por producto, así que es su clave natural y evita reconciliar ids tras C-005.

No existen todavía comandos de build, lint o test. Cuando se arranque el proyecto, documentarlos aquí y sustituir este párrafo.

El siguiente paso previsto es definir la arquitectura funcional, la experiencia de usuario, la estrategia de sincronización y el detalle del stack, ya sobre las decisiones cerradas.

## Stack decidido

- **PWA** servida como URL y añadible a la pantalla de inicio del iPhone. Nada de app nativa: el desarrollo es en Windows y el presupuesto es cero (D-018). El **service worker no es opcional**: sin él la app no carga sin conexión y se incumplen RF-024 y RNF-003.
- **Vite + React + TypeScript + TanStack Router**, desplegado en Vercel. **Next.js está descartado** (D-021): Vercel no lo requiere, y el App Router rompe la navegación offline. No reintroducirlo.
- **TanStack Query persistido** en IndexedDB como capa offline (D-022), con mutaciones pausadas que se reanudan. TanStack Table está descartada: no hay tablas, hay listas en un móvil.
- **Zod** en las tres fronteras: Realtime, IndexedDB y formularios. **shadcn/ui** con áreas de toque de 44 px y *drawer* en vez de *dialog* (se usa con una mano en un pasillo). pnpm, Vitest, Playwright, Biome.
- **Supabase** con autenticación anónima y Realtime (D-019, D-020). No trae persistencia offline: esa capa es nuestra.

## Reglas no negociables del local-first

Tres invariantes técnicas de las que depende que el offline funcione. Romper cualquiera de ellas rompe la sincronización de formas difíciles de depurar:

1. **Los ids se generan en el cliente** con `crypto.randomUUID()`, nunca en el servidor (D-024). Sin esto no hay creación offline.
2. **Toda escritura es idempotente.** Pasa por la función de fusión que aplica campo a campo comparando `field_updated_at`, así que reenviar una mutación en cola no duplica ni corrompe (D-025).
3. **Nada se borra físicamente**, se marca `deleted_at` / `removed_at` (D-026). Un dispositivo desconectado no puede enterarse de una fila que desapareció. Un parche nunca resucita una lápida: de ahí salen gratis los conflictos C-001 y C-004.

La interfaz **nunca lee de la red**: lee de la caché de TanStack Query, persistida en IndexedDB.

Cuatro reglas más al tocar sincronización (el detalle está en `docs/estrategia_sincronizacion_v0.1.md`):

4. **Las mutaciones salen en serie**, con `scope: { id: 'sync' }` compartido. En paralelo, un `list_item` puede adelantar al producto al que apunta. Y hay que registrar `setMutationDefaults` con su `mutationFn` **antes** de hidratar, o las mutaciones rehidratadas se reanudan sin función y se pierden en silencio.
5. **Realtime no es la fuente de verdad** (D-028): no reproduce lo perdido con el socket caído. Siempre hay delta pull por cursor al arrancar, al recuperar red, al volver a primer plano y al reconectar.
6. **Dos relojes, dos trabajos:** `field_updated_at` usa la hora del cliente acotada al `now()` del servidor (representa cuándo decidió el usuario); `updated_at` usa siempre `now()` del servidor, porque es el cursor. Escribir el reloj del cliente en `updated_at` hace que las filas de un móvil atrasado no se descarguen nunca.
7. **El service worker cachea el armazón, nunca las llamadas a Supabase** (van en solo-red). Dos cachés con invalidaciones distintas acaban mostrando datos más viejos que los de IndexedDB.

## Producto

App para gestionar la lista de mercado compartida de un hogar de **dos personas, ambas en iPhone**. El objetivo es no reconstruir la lista de compras desde cero cada vez: se mantiene un catálogo permanente de productos habituales y se marca cuáles hacen falta ahora.

Restricciones que condicionan casi cualquier decisión técnica:

- **Sincronización casi en tiempo real** entre los dos dispositivos (RNF-002, RF-016).
- **Funcionamiento offline** con sincronización posterior sin pérdida de cambios (RF-024, RNF-003).
- **Sin login tradicional**: un usuario crea un hogar, obtiene un código y el otro se une con ese código (RF-022).
- Prioridad absoluta a **baja fricción** en las tres operaciones frecuentes: agregar producto existente a la lista, marcar producto durante la compra, consultar los productos de un supermercado (RNF-001).

## Modelo de dominio

La distinción central, de la que se derivan la mayoría de las reglas, es **catálogo ≠ lista de mercado**:

```
HOGAR ──┬── Usuarios/dispositivos
        ├── Supermercados        (Supermu, D1, …)
        ├── Categorías
        └── Productos            (nombre, marca opcional, categoría, supermercado habitual)
                 │
                 └── Item de lista  (creado al agregar al mercado: cantidad + estado de marcado)
```

- El **producto** vive permanentemente en el catálogo, exista o no la necesidad de comprarlo.
- El **item de lista** es lo que se agrega a la compra actual y es quien lleva la información propia de esa ocasión: cantidad y marcado "ya está en el carrito". La cantidad no es un atributo permanente del producto.
- El **supermercado habitual** del producto es una preferencia, no una restricción; la lista de mercado se agrupa siempre por supermercado y nunca se presenta como lista plana (RF-014, RN-010).

### Invariantes a respetar en cualquier implementación

1. Crear un producto no lo agrega a la lista de mercado.
2. Quitar de la lista no elimina del catálogo.
3. Marcar un producto no lo saca de la lista de inmediato: solo lo hace **finalizar compra**.
4. Al finalizar compra: los marcados salen de la lista, los **no marcados permanecen** en ella, y todos siguen en el catálogo. Finalizar debe poder ejecutarse aunque queden productos sin marcar.

## Alcance

Dentro del MVP: productos, supermercados, supermercado habitual, lista de mercado, cantidad por compra, marca opcional, categorías, marcado durante la compra, finalización, sincronización entre dos dispositivos, offline y vinculación por código de hogar.

Fuera del MVP (no implementar sin que el usuario lo pida): historial de compras, precios, estadísticas, sugerencias automáticas, ubicación/GPS y detección de sucursal, múltiples listas, roles, cuentas con contraseña.

El modelo de datos sí debe **dejar la puerta abierta** a: sucursales de un mismo supermercado, orden de recorrido propio por supermercado (RF-021), historial y más de dos usuarios por hogar (RNF-006).

Las ideas de V2 que van surgiendo del uso real (Fase 8) se recogen en `docs/backlog_v2.md`: no están decididas ni priorizadas, no se implementan sin que el usuario lo pida.

## Reglas de interfaz

Se usa **con una mano, de pie, empujando un carro**. Eso decide casi todo (detalle en `docs/experiencia_usuario_v0.1.md`):

- Dos pestañas abajo, **Mercado** como pantalla de arranque (D-033). Todo lo que se abre encima es *drawer* desde abajo, nunca diálogo centrado: el pulgar está abajo.
- Área de toque mínima de 44 px, y **la fila entera es la zona de toque**, no el icono. En el Mercado, tocar una fila la marca; abrir el detalle solo se hace desde el Catálogo.
- Ninguna acción frecuente muestra indicador de carga: las escrituras son optimistas. Nada se revierte solo en pantalla; si una mutación cae en cuarentena, se avisa y el estado local se mantiene.
- iOS no soporta `navigator.vibrate`: la respuesta al marcar es visual, no háptica.
- En modo pantalla completa **no hay botón de atrás**, así que toda capa necesita su propia salida visible. `viewport-fit=cover` con `env(safe-area-inset-bottom)` en la barra, y `overscroll-behavior: none` para que tirar de la lista no recargue la app en mitad de una compra.

Sobre el aspecto, antes de escribir cualquier componente hay que leer `docs/identidad_visual_v0.1.md` y cargar la guía `frontend-design`. Lo esencial:

- **Nada de emojis** en ninguna parte de la interfaz (D-035). Los iconos son de Lucide, trazo 1.75, `currentColor`.
- **El lenguaje visual es la señalización de supermercado**: tipografía condensada y pesada, contraste máximo, cero decoración. Ni verduras ilustradas ni pasteles, ni pastiche de tique en monoespaciada.
- **El color pertenece a los supermercados** (D-036). El resto de la interfaz es acromática, con negro real (`#000`), no un negro teñido.
- **Sin tarjetas ni sombras** para separar contenido: las filas son franjas, no cajas. La sombra se reserva para lo que flota de verdad (drawer y barra). El radio codifica función: `0` en bandas, `4px` en controles, píldora solo en el contador.
- **shadcn/ui aporta comportamiento, no aspecto** (D-038): se sustituye su capa de tokens entera.
- **Un único momento con movimiento**: la fila que viaja al grupo de comprados al marcarla.

## Decisiones

La sección 14 del ARF listaba nueve decisiones abiertas. **Ya están cerradas en `docs/decisiones_cerradas_v0.1.md`**, junto con varias que el ARF no contemplaba; no volver a plantearlas ni resolverlas por cuenta propia. Las de mayor impacto en el código:

- Finalizar compra es **por supermercado**, acotado a los items marcados en el momento de pulsar (D-001).
- El supermercado del producto es **opcional**, con grupo "Sin asignar" (D-002).
- El item de lista es **entidad propia**, no un flag sobre el producto (D-003).
- La lista usa **secciones, no pestañas**: el hogar tiene dos supermercados (D-007).
- Conflictos: **último en escribir gana, campo a campo**, con cuatro escenarios resueltos explícitamente en la tabla C-001…C-004.
- El código del hogar es **permanente, reutilizable y regenerable**, y es la única vía de recuperación tras reinstalar (D-014).

Lo que sigue abierto está en la sección 6 de ese documento y es todo diferido a post-MVP; son decisiones del usuario, no defaults a inventar.

## Convenciones

La documentación del proyecto está en español y numera sus elementos (`RF-0xx` requerimientos, `RN-0xx` reglas de negocio, `CU-0xx` casos de uso, `RNF-0xx` no funcionales, `UX-0xx` decisiones de UX pendientes). Mantener esa nomenclatura y citar los identificadores al justificar decisiones de implementación.
