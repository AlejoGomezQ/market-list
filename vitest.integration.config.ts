/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Pruebas de integración de Fase 1 contra el Postgres local de `supabase start` (ver
// supabase/tests/db.ts). Config aparte de vite.config.ts porque no necesitan jsdom ni el setup de
// React, y sí necesitan Docker arriba, que no es una condición para `pnpm test`.
export default defineConfig({
	test: {
		environment: "node",
		include: ["supabase/tests/**/*.integration.test.ts"],
		testTimeout: 20_000,
	},
});
