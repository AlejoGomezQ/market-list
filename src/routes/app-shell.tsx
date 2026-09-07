import { Outlet } from "@tanstack/react-router";
import { BottomNav } from "@/components/bottom-nav";
import { supabaseConfigError } from "@/lib/supabase";

/**
 * Armazón visible en toda la app: el contenido de la ruta activa arriba y la
 * barra de dos pestañas fija abajo (D-033). No hay botón de atrás en modo
 * pantalla completa, así que cada pantalla que se abra encima de esto
 * necesita su propia salida (drawers, Fase 2b en adelante) — este shell solo
 * resuelve la navegación de nivel superior.
 *
 * El aviso de configuración es deliberadamente mínimo (una franja de texto, sin diseño de Fase 5):
 * el despliegue de Vercel actual no tiene las variables de Supabase, y sin este aviso el fallo
 * quedaría solo en consola, invisible para quien abra la URL en el iPhone.
 */
export function AppShell() {
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
