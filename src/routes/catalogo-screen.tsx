import { Link, Outlet } from "@tanstack/react-router";
import { Settings } from "lucide-react";

/**
 * Pantalla de relleno mínima (Fase 0) más la cabecera de Fase 2b: el icono de Ajustes vive aquí,
 * no en la barra de pestañas (experiencia_usuario §3, "se visita tres veces al año"). El contenido
 * real del catálogo permanente de productos, con su detalle y supermercado habitual, llega en
 * fases posteriores (3/4).
 *
 * `<Outlet />` al final monta `/catalogo/ajustes` cuando esa ruta está activa: Ajustes es un
 * drawer (D-023), no una pantalla propia, así que se dibuja encima de este mismo contenido en vez
 * de reemplazarlo.
 */
export function CatalogoScreen() {
	return (
		<section className="flex h-full flex-col">
			<header className="flex items-center justify-between px-4 py-6">
				<h1 className="text-26 font-bold wdth-75">Catálogo</h1>
				<Link
					to="/catalogo/ajustes"
					aria-label="Ajustes"
					className="flex size-[var(--size-tap)] items-center justify-center text-foreground"
				>
					<Settings aria-hidden="true" className="size-5" strokeWidth={1.75} />
				</Link>
			</header>
			<p className="px-4 text-14 text-muted-foreground">
				Aquí vivirá el catálogo permanente de productos del hogar.
			</p>
			<Outlet />
		</section>
	);
}
