/**
 * Pantalla de relleno mínima (Fase 0). El contenido real — la lista de
 * mercado agrupada por supermercado, con marcado y finalizar compra — llega
 * en fases posteriores (3/4); aquí solo se deja la ruta de arranque montada.
 */
export function MercadoScreen() {
	return (
		<section className="px-4 py-6">
			<h1 className="text-26 font-bold wdth-75">Mercado</h1>
			<p className="mt-2 text-14 text-muted-foreground">
				Aquí vivirá la lista de mercado agrupada por supermercado.
			</p>
		</section>
	);
}
