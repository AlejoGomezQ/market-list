# Market List

PWA de lista de mercado para un hogar de dos personas. Mantiene un catálogo permanente de
productos habituales, agrupados por supermercado, y una lista de compra actual donde se marca lo
que ya se consiguió. Sincroniza casi en tiempo real entre los dos iPhone del hogar y sigue
funcionando sin conexión.

## Estado actual

Proyecto en desarrollo activo, todavía sin interfaz funcional de dominio. Según los commits y lo
que existe en el repo:

- **Fase 0 (andamiaje y primer despliegue) — completa.** Vite + React + TypeScript con pnpm,
  Biome y Vitest; Tailwind v4 y shadcn/ui con los tokens de identidad visual propios;
  `vite-plugin-pwa` configurado; TanStack Router con las dos pestañas (Mercado y Catálogo) y
  pantallas de relleno; CI en GitHub Actions con lint, build y test.
- **Fase 1 (datos y seguridad) — en curso.** Ya están las migraciones de Supabase con las cinco
  tablas del dominio, el trigger que fuerza `updated_at`, las políticas RLS de lectura y la
  publicación de Realtime, además de los tipos generados y los esquemas Zod de frontera. Falta lo
  que las propias migraciones marcan como pendiente: las funciones `sync_push`,
  `create_household` y `join_household` (Fase 1b), y la batería de tests de integración contra
  Postgres que es el criterio de "listo" de esta fase.

Todavía no hay proyecto de Supabase remoto desplegado ni lista de mercado utilizable: el desarrollo
solo corre contra Supabase local.

El detalle completo de las fases y sus criterios está en
[`docs/plan_implementacion_v0.1.md`](docs/plan_implementacion_v0.1.md).

## Stack

- Vite + React + TypeScript + TanStack Router
- Tailwind CSS + shadcn/ui (solo su comportamiento; los tokens de aspecto son propios)
- Supabase (Postgres, autenticación anónima, Realtime) — sin capa de persistencia offline propia
  todavía
- Zod para validar en las fronteras del dominio
- PWA con `vite-plugin-pwa` (service worker, manifiesto, instalable en iPhone)
- Biome, Vitest, pnpm

El razonamiento detrás de cada decisión de stack está en `CLAUDE.md` y en
[`docs/decisiones_cerradas_v0.1.md`](docs/decisiones_cerradas_v0.1.md).

## Cómo levantar el proyecto

Requiere Node, [pnpm](https://pnpm.io) y Docker Desktop corriendo (para Supabase local).

```bash
pnpm install
pnpm dev
```

Para levantar Supabase local (base de datos, Auth, Realtime, Studio):

```bash
pnpm exec supabase start
```

El proyecto todavía no consume variables de entorno desde el cliente (no hay ningún
`import.meta.env.VITE_*` en el código ni un `.env.example` en el repo): la conexión a Supabase
todavía no está integrada en la app. Cuando exista, este README y un `.env.example` se
actualizarán con lo que haga falta.

## Scripts

Los scripts reales, tal como están en `package.json`:

| Script | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo de Vite |
| `pnpm build` | Type-check (`tsc -b`) y build de producción |
| `pnpm preview` | Sirve el build de producción localmente |
| `pnpm lint` | Revisa el código con Biome |
| `pnpm lint:fix` | Igual que `lint`, aplicando los arreglos automáticos |
| `pnpm test` | Corre la suite de Vitest una vez |
| `pnpm test:watch` | Vitest en modo watch |
| `pnpm gen:types` | Genera los tipos TypeScript desde el esquema de Supabase local |

## Documentación

Toda la definición funcional, de arquitectura y de diseño vive en [`docs/`](docs). Para el
resumen operativo pensado para trabajar en el código —invariantes del dominio, reglas del
local-first, convenciones— está [`CLAUDE.md`](CLAUDE.md).
