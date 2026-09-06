import {
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { AppShell } from "@/routes/app-shell";
import { CatalogoScreen } from "@/routes/catalogo-screen";
import { MercadoScreen } from "@/routes/mercado-screen";

/**
 * Árbol de rutas definido a mano (createRootRoute/createRoute/createRouter),
 * sin el plugin de generación por archivos de TanStack Router. El proyecto
 * ya suma dos plugins de Vite (Tailwind y vite-plugin-pwa) y, con solo dos
 * rutas de nivel superior fijas por el MVP (Mercado y Catálogo, D-033), un
 * generador de código no aporta nada frente al costo de otro paso de build
 * y otro archivo de rutas generado que mantener sincronizado.
 *
 * Mercado vive en "/" — es la pantalla de arranque (D-033).
 */
const rootRoute = createRootRoute({
	component: AppShell,
});

const mercadoRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: MercadoScreen,
});

const catalogoRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/catalogo",
	component: CatalogoScreen,
});

const routeTree = rootRoute.addChildren([mercadoRoute, catalogoRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
