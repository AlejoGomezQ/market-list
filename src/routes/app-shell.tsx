import { Outlet } from "@tanstack/react-router";
import { BottomNav } from "@/components/bottom-nav";

/**
 * Armazón visible en toda la app: el contenido de la ruta activa arriba y la
 * barra de dos pestañas fija abajo (D-033). No hay botón de atrás en modo
 * pantalla completa, así que cada pantalla que se abra encima de esto
 * necesita su propia salida (drawers, Fase 2b en adelante) — este shell solo
 * resuelve la navegación de nivel superior.
 */
export function AppShell() {
	return (
		<div className="flex min-h-dvh flex-col">
			<main className="flex-1 overflow-y-auto">
				<Outlet />
			</main>
			<BottomNav />
		</div>
	);
}
