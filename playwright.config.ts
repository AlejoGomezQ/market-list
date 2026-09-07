import { defineConfig, devices } from "@playwright/test";

/**
 * Fase 7 (plan_implementacion §"Fase 7 — Detalles finales"): "Playwright no reproduce iOS" es
 * una limitación conocida y documentada (mismo plan, tabla de riesgos) -- se ejecuta contra
 * WebKit de escritorio a propósito, no como sustituto de probar en el iPhone real, sino para
 * cubrir el flujo de dominio de punta a punta en CI.
 *
 * Contra `pnpm run preview` (el build de producción real, con el service worker generado), no
 * contra el servidor de desarrollo: el escenario incluye altas reales por RPC contra Supabase
 * (`create_household`), así que hace falta Supabase local corriendo aparte (Docker, nunca el
 * proyecto remoto) con `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` ya en el entorno antes de
 * `pnpm run build` (Vite las incrusta en el build, no las lee en caliente).
 */
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: "line",
	use: {
		baseURL: "http://127.0.0.1:4173",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "webkit-desktop",
			use: { ...devices["Desktop Safari"] },
		},
	],
	webServer: {
		// `build` primero: `vite preview` solo sirve `dist/`, y las variables de Supabase se
		// incrustan en tiempo de build (Vite), no se leen en caliente al arrancar el preview.
		// `--host 127.0.0.1` explícito: sin él, `vite preview` en este entorno escucha solo en
		// `::1` (IPv6) y la comprobación de `url` de Playwright contra `127.0.0.1` no conecta
		// nunca -- timeout silencioso, nada que ver con el build.
		command:
			"pnpm exec vite build && pnpm exec vite preview --port 4173 --host 127.0.0.1",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
