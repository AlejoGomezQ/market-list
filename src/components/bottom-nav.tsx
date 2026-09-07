import { Link } from "@tanstack/react-router";
import { LayoutGrid, ShoppingCart } from "lucide-react";

/**
 * Barra de navegación de dos pestañas (D-033), fija abajo. Mercado es la
 * pantalla de arranque. Sin botón de atrás en modo pantalla completa: esta
 * barra es la única navegación de nivel superior, siempre visible.
 *
 * - Área de toque: min-height 44px (--min-height-tap), toda la pestaña.
 * - Safe area: `pb-safe` (docs/experiencia_usuario_v0.1.md, viewport-fit=cover).
 * - Color: --ink para el activo (text-foreground), --ink-mute para el
 *   inactivo (text-muted-foreground) — el color se reserva a los
 *   supermercados (D-036), así que no hay acento nuevo aquí.
 * - Iconos Lucide, trazo 1.75, sin emojis (D-035).
 */
const TABS = [
	{ to: "/", label: "Mercado", Icon: ShoppingCart },
	{ to: "/catalogo", label: "Catálogo", Icon: LayoutGrid },
] as const;

export function BottomNav() {
	return (
		<nav
			aria-label="Navegación principal"
			className="pb-safe flex border-t border-border bg-background"
		>
			{TABS.map(({ to, label, Icon }) => (
				<Link
					key={to}
					to={to}
					className="flex min-h-[var(--min-height-tap)] flex-1 flex-col items-center gap-0.5 pt-2.5"
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					activeOptions={{ exact: to === "/" }}
				>
					<Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
					<span className="text-13">{label}</span>
				</Link>
			))}
		</nav>
	);
}
