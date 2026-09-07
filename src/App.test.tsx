import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setHouseholdLink } from "./lib/household-link";
import { createSyncQueryClient } from "./lib/query-client";
import { createAppRouter } from "./router";

const HOUSEHOLD = {
	householdId: "11111111-1111-4111-8111-111111111111",
	name: "Casa",
	joinCode: "ABCDEFGH",
};

/**
 * Un router (y un `QueryClient`) nuevo por prueba, no el singleton de `router.tsx`: ese singleton
 * cachea las coincidencias de ruta por `href`, así que dos montajes seguidos en la misma ruta no
 * reevalúan `beforeLoad` aunque `localStorage` haya cambiado entre medio -- justo lo que hace falta
 * probar aquí (`router.tsx` documenta el motivo junto a `createAppRouter`).
 */
function renderAt(path: string) {
	window.history.pushState({}, "", path);
	render(
		<QueryClientProvider client={createSyncQueryClient()}>
			<RouterProvider router={createAppRouter()} />
		</QueryClientProvider>,
	);
}

describe("App", () => {
	it("con hogar vinculado, arranca en Mercado, la ruta raíz (D-033)", async () => {
		localStorage.clear();
		setHouseholdLink(HOUSEHOLD);
		renderAt("/");
		expect(
			await screen.findByRole("heading", { name: /mercado/i }),
		).toBeInTheDocument();
	});

	it("con hogar vinculado, muestra la barra de navegación con las dos pestañas del MVP", async () => {
		localStorage.clear();
		setHouseholdLink(HOUSEHOLD);
		renderAt("/");
		await screen.findByRole("heading", { name: /mercado/i });
		expect(screen.getByRole("link", { name: /mercado/i })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /catálogo/i })).toBeInTheDocument();
	});

	it("sin hogar vinculado todavía, redirige a onboarding en vez de la barra de pestañas (D-014)", async () => {
		localStorage.clear();
		renderAt("/");
		expect(
			await screen.findByRole("heading", { name: /empezamos/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: /mercado/i }),
		).not.toBeInTheDocument();
	});

	it("con hogar ya vinculado, entrar a /onboarding redirige de vuelta a Mercado", async () => {
		localStorage.clear();
		setHouseholdLink(HOUSEHOLD);
		renderAt("/onboarding");
		expect(
			await screen.findByRole("heading", { name: /mercado/i }),
		).toBeInTheDocument();
	});
});
