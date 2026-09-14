import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { getHouseholdLinks } from "@/lib/household-link";
import { AjustesDrawer } from "@/routes/ajustes-screen";
import { AppShell } from "@/routes/app-shell";
import { CatalogoScreen } from "@/routes/catalogo-screen";
import { HistorialScreen } from "@/routes/historial-screen";
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
 *   Router), que monta `AppShell` (barra de tres pestañas, D-033 revisada por D-042) alrededor de
 *   Mercado, Catálogo e Historial.
 *
 * El guardado de cada rama es el espejo de la otra en `beforeLoad`: sin hogar vinculado, cualquier
 * ruta de `shell` redirige a onboarding; con hogar ya vinculado, onboarding redirige a Mercado --
 * salvo en modo "añadir otro hogar" (`?add=1`, D-046), que sí deja abrir onboarding aunque ya haya
 * vínculo. La comprobación es síncrona (localStorage, no red) porque el vínculo del dispositivo con
 * su hogar no es uno de los cuatro recursos que vive en la caché de TanStack Query.
 *
 * "Tener hogar" es `getHouseholdLinks().length > 0` (D-043: un dispositivo puede seguir varios): hoy
 * equivale a lo de siempre, pero deja explícito que el guardia es binario aunque el vínculo ya no.
 */
const rootRoute = createRootRoute({
	component: Outlet,
});

const onboardingSearchSchema = z.object({
	// `?add=1` (D-046): entra a onboarding para añadir OTRO hogar teniendo ya uno. Sin `add`, el
	// guardia de abajo redirige a Mercado como siempre.
	add: z.boolean().optional().catch(undefined),
});

const onboardingRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/onboarding",
	validateSearch: (search) => onboardingSearchSchema.parse(search),
	beforeLoad: ({ search }) => {
		if (getHouseholdLinks().length > 0 && !search.add)
			throw redirect({ to: "/" });
	},
	component: OnboardingScreen,
});

const shellRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "shell",
	beforeLoad: () => {
		if (getHouseholdLinks().length === 0) throw redirect({ to: "/onboarding" });
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

const historialRoute = createRoute({
	getParentRoute: () => shellRoute,
	path: "/historial",
	component: HistorialScreen,
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
		historialRoute,
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
