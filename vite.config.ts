/// <reference types="vitest/config" />
import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Solo en el build de Vercel: sube los source maps a Sentry para que los stack traces de
// producción sean legibles (backlog_v2 §7). `SENTRY_AUTH_TOKEN` es un secreto de build, nunca
// llega al cliente (no lleva prefijo VITE_). Sin el token -- local y CI -- el plugin no se
// carga y el build sigue igual.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

// La versión del despliegue para Sentry: la variable explícita si está, y si no el SHA del commit
// que Vercel expone de fábrica en el build (`VERCEL_GIT_COMMIT_SHA`). Así no hace falta configurar
// `VITE_SENTRY_RELEASE` a mano. Vite ya sustituye `import.meta.env.VITE_*` por su cuenta, pero
// `VERCEL_GIT_COMMIT_SHA` no lleva ese prefijo, de ahí el `define`.
const sentryRelease =
	process.env.VITE_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

// https://vite.dev/config/
export default defineConfig({
	...(sentryRelease
		? {
				define: {
					"import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease),
				},
			}
		: {}),
	// Source maps solo cuando hay token para subirlos (el build de Vercel). 'hidden': se generan
	// pero sin el comentario `sourceMappingURL` en el JS; Sentry los sube y luego los borra, así
	// que no se sirven en producción.
	build: { sourcemap: sentryAuthToken ? "hidden" : false },
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			// 'prompt', no 'autoUpdate' (CLAUDE.md, "Reglas no negociables del
			// local-first" y docs/plan_implementacion_v0.1.md Fase 0): con
			// autoUpdate habría recargas por sorpresa a mitad de una alta larga
			// de productos (Fase 4) o con la cola de sincronización llena
			// (Fase 6). El aviso de actualización visible es Fase 7
			// (src/components/update-banner.tsx).
			registerType: "prompt",
			manifest: {
				name: "Lista de Mercado",
				short_name: "Mercado",
				description:
					"Lista de mercado compartida del hogar, con catálogo permanente de productos.",
				lang: "es",
				display: "standalone",
				// Negro real, no un negro teñido (docs/identidad_visual_v0.1.md #2).
				theme_color: "#000000",
				background_color: "#000000",
				icons: [
					{
						src: "pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "maskable-icon-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				// Defensivo e intencional, no redundante: por defecto Workbox solo
				// precachea el armazón del build (JS/CSS/HTML/iconos), lo cual ya
				// cumple la regla 7 de CLAUDE.md ("el service worker cachea el
				// armazón, nunca las llamadas a Supabase"). Esta regla deja esa
				// garantía escrita en código en vez de depender solo de que
				// Workbox "no lo cachee por omisión": cualquier request a
				// Supabase (Realtime, PostgREST, Auth) va siempre a red, nunca a
				// caché, porque dos cachés con invalidaciones distintas terminan
				// mostrando datos más viejos que los de IndexedDB.
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
						handler: "NetworkOnly",
					},
				],
			},
		}),
		...(sentryAuthToken
			? [
					sentryVitePlugin({
						org: "alejogomezorg",
						project: "market-list",
						authToken: sentryAuthToken,
						release: sentryRelease ? { name: sentryRelease } : undefined,
						sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
					}),
				]
			: []),
	],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		globals: true,
		// Las pruebas de integración de supabase/tests hablan directo con Postgres (ver
		// vitest.integration.config.ts) y corren aparte con `pnpm test:integration`: necesitan
		// `supabase start` arriba, y no tiene sentido bloquear `pnpm test` con eso. `e2e/` son
		// specs de Playwright (`*.spec.ts` calza con el patrón por defecto de Vitest, así que sin
		// esta exclusión Vitest también intentaría correrlas, y fallan fuera de un navegador real
		// -- van aparte con `pnpm test:e2e`, ver playwright.config.ts).
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"supabase/tests/**",
			"e2e/**",
		],
	},
});
