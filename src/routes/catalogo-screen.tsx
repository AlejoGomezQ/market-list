/**
 * Pantalla de relleno mínima (Fase 0). El contenido real — el catálogo
 * permanente de productos, con su detalle y supermercado habitual — llega en
 * fases posteriores (3/4); aquí solo se deja la ruta montada.
 */
export function CatalogoScreen() {
	return (
		<section className="px-4 py-6">
			<h1 className="text-26 font-bold wdth-75">Catálogo</h1>
			<p className="mt-2 text-14 text-muted-foreground">
				Aquí vivirá el catálogo permanente de productos del hogar.
			</p>
		</section>
	);
}
