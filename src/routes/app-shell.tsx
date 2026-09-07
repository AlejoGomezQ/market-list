import { useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { BottomNav } from "@/components/bottom-nav";
import { getHouseholdLink } from "@/lib/household-link";
import { supabaseConfigError } from "@/lib/supabase";
import { useSyncEngine } from "@/lib/sync/engine";

/**
 * Armazón visible en toda la app: el contenido de la ruta activa arriba y la
 * barra de dos pestañas fija abajo (D-033). No hay botón de atrás en modo
 * pantalla completa, así que cada pantalla que se abra encima de esto
 * necesita su propia salida (drawers, Fase 2b en adelante) — este shell solo
 * resuelve la navegación de nivel superior.
 *
 * `AppShell` monta una sola vez mientras el dispositivo se queda dentro de las dos pestañas
 * (el guardia de router.tsx solo lo desmonta al volver a onboarding), así que es el sitio para
 * arrancar el motor de sincronización del hogar (`lib/sync/engine.ts`: delta pull + Realtime con
 * el reductor real, Fase 6) una sola vez por hogar, en vez de una vez por pantalla.
 *
 * El aviso de configuración es deliberadamente mínimo (una franja de texto, sin diseño de Fase 5):
 * el despliegue de Vercel actual no tiene las variables de Supabase, y sin este aviso el fallo
 * quedaría solo en consola, invisible para quien abra la URL en el iPhone.
 */
export function AppShell() {
	const householdId = getHouseholdLink()?.householdId;
	const queryClient = useQueryClient();
	useSyncEngine(householdId, queryClient);

	return (
		<div className="flex min-h-dvh flex-col">
			{supabaseConfigError ? (
				<p
					role="alert"
					className="bg-destructive px-4 py-2 text-13 text-destructive-foreground"
				>
					{supabaseConfigError}
				</p>
			) : null}
			<main className="flex-1 overflow-y-auto">
				<Outlet />
			</main>
			<BottomNav />
		</div>
	);
}
