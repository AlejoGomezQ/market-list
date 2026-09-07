import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { getHouseholdLink } from "@/lib/household-link";
import { AjustesDrawer } from "@/routes/ajustes-screen";
import { AppShell } from "@/routes/app-shell";
import { CatalogoScreen } from "@/routes/catalogo-screen";
import { MercadoScreen } from "@/routes/mercado-screen";
import { OnboardingScreen } from "@/routes/onboarding-screen";

/**
 * Árbol de rutas definido a mano (createRootRoute/createRoute/createRouter), sin el plugin de
 * generación por archivos de TanStack Router — mismo motivo que en Fase 0: pocas rutas fijas por
 * el MVP, un generador no aporta nada frente al costo de otro paso de build.
 *
 * Dos ramas bajo la raíz (experiencia_usuario §3, plan_implementacion Fase 2b):
 *
 * - `onboarding`: pantalla previa a todo lo demás, sin barra de pestañas, mientras el dispositivo
 *   no tenga hogar vinculado (D-014 vía `household-link.ts`).
 * - `shell`: ruta sin tramo propio en la URL (`id`, no `path` — un "layout route" de TanStack
 *   Router), que monta `AppShell` (barra de dos pestañas, D-033) alrededor de Mercado y Catálogo.
 *
 * El guardado de cada rama es el espejo de la otra en `beforeLoad`: sin hogar vinculado, cualquier
 * ruta de `shell` redirige a onboarding; con hogar ya vinculado, onboarding redirige a Mercado. La
 * comprobación es síncrona (localStorage, no red) porque el vínculo del dispositivo con su hogar
 * no es uno de los cuatro recursos que vive en la caché de TanStack Query.
 */
const rootRoute = createRootRoute({
	component: Outlet,
});

const onboardingRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/onboarding",
	beforeLoad: () => {
		if (getHouseholdLink()) throw redirect({ to: "/" });
	},
	component: OnboardingScreen,
});

const shellRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "shell",
	beforeLoad: () => {
		if (!getHouseholdLink()) throw redirect({ to: "/onboarding" });
	},
	component: AppShell,
});

const mercadoRoute = createRoute({
	getParentRoute: () => shellRoute,
	path: "/",
	component: MercadoScreen,
});

const catalogoRoute = createRoute({
	getParentRoute: () => shellRoute,
	path: "/catalogo",
	component: CatalogoScreen,
});

/**
 * Ajustes "vive tras un icono en la cabecera del Catálogo, no en la barra" (experiencia_usuario
 * §3) y se abre como drawer (D-023), nunca como pantalla propia: por eso cuelga de `catalogoRoute`
 * en vez de ser una rama de nivel superior — `CatalogoScreen` sigue debajo, visible detrás del
 * drawer, y cerrar el drawer es simplemente volver a `/catalogo`.
 */
const ajustesRoute = createRoute({
	getParentRoute: () => catalogoRoute,
	path: "/ajustes",
	component: AjustesDrawer,
});

const routeTree = rootRoute.addChildren([
	onboardingRoute,
	shellRoute.addChildren([
		mercadoRoute,
		catalogoRoute.addChildren([ajustesRoute]),
	]),
]);

/**
 * Fábrica, no solo el singleton de más abajo: las pruebas de `beforeLoad` (App.test.tsx) necesitan
 * un router propio por caso, porque el `router` compartido cachea las coincidencias de ruta ya
 * resueltas por `href` y no vuelve a evaluar `beforeLoad` solo porque cambie `localStorage` entre
 * dos montajes seguidos en la misma ruta.
 */
export function createAppRouter() {
	return createRouter({ routeTree });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
