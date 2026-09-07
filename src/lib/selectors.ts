import type {
	Category,
	ListItem,
	Product,
	Supermarket,
} from "@/schemas/domain";

/**
 * Selectores en memoria sobre las cuatro consultas persistidas (CLAUDE.md, plan_implementacion
 * Fase 2a): funciones puras, no queries nuevas. Todo filtro, orden, agrupación y búsqueda de la
 * interfaz pasa por aquí en lugar de por una consulta parametrizada.
 */

/**
 * Los items de lista se indexan por `product_id`, no por su propio id (CLAUDE.md; arquitectura
 * §3, C-005): el índice único parcial de la Fase 1 garantiza como mucho un item activo por
 * producto, así que `product_id` es su clave natural y evita reconciliar ids tras un choque de
 * altas casi simultáneas. Los items ya retirados (`removed_at` no nulo) no entran aquí.
 */
export function indexActiveListItemsByProduct(
	listItems: ListItem[],
): Map<string, ListItem> {
	const byProduct = new Map<string, ListItem>();
	for (const item of listItems) {
		if (item.removed_at !== null) continue;
		byProduct.set(item.product_id, item);
	}
	return byProduct;
}

/** Búsqueda de productos por nombre o marca, insensible a mayúsculas (RF-001, D-006). */
export function searchProducts(products: Product[], query: string): Product[] {
	const q = query.trim().toLowerCase();
	if (!q) return products;
	return products.filter(
		(product) =>
			product.name.toLowerCase().includes(q) ||
			(product.brand?.toLowerCase().includes(q) ?? false),
	);
}

export interface MarketSection {
	/** `null` es el grupo "Sin asignar" (D-002). */
	supermarket: Supermarket | null;
	entries: Array<{ item: ListItem; product: Product }>;
}

/**
 * Agrupa la lista de mercado por supermercado y ordena cada grupo por categoría (D-007, D-031,
 * RF-014, RN-010). Reglas que vienen directas de la arquitectura (§4.3) y no son incidentales:
 *
 * - Un producto borrado no se pinta, aunque su item siga activo (fila fantasma tras un choque
 *   offline).
 * - Un producto cuyo supermercado esté borrado, o sin supermercado asignado, cae en "Sin asignar".
 * - Dentro de cada grupo, el orden es `categories.position`; los productos sin categoría van al
 *   final del grupo.
 * - Los supermercados se ordenan por `(position, created_at)` (arquitectura §4.2); solo aparecen
 *   los que tienen al menos un item activo -- esta es la lista de compra, no el catálogo.
 */
export function groupMarketListBySupermarket(
	listItems: ListItem[],
	products: Product[],
	supermarkets: Supermarket[],
	categories: Category[],
): MarketSection[] {
	const productById = new Map(products.map((product) => [product.id, product]));
	const liveSupermarketById = new Map(
		supermarkets.filter((s) => s.deleted_at === null).map((s) => [s.id, s]),
	);
	const categoryPosition = new Map(categories.map((c) => [c.id, c.position]));

	const bySupermarket = new Map<
		string | null,
		Array<{ item: ListItem; product: Product }>
	>();

	for (const item of indexActiveListItemsByProduct(listItems).values()) {
		const product = productById.get(item.product_id);
		if (!product || product.deleted_at !== null) continue;

		const supermarketId =
			product.supermarket_id && liveSupermarketById.has(product.supermarket_id)
				? product.supermarket_id
				: null;

		const entries = bySupermarket.get(supermarketId) ?? [];
		entries.push({ item, product });
		bySupermarket.set(supermarketId, entries);
	}

	const byCategoryOrder = (
		a: { product: Product },
		b: { product: Product },
	): number => {
		const posOf = (p: Product) =>
			p.category_id
				? (categoryPosition.get(p.category_id) ?? Number.POSITIVE_INFINITY)
				: Number.POSITIVE_INFINITY;
		return posOf(a.product) - posOf(b.product);
	};

	const orderedSupermarkets = [...supermarkets]
		.filter((s) => s.deleted_at === null)
		.sort(
			(a, b) =>
				a.position - b.position || a.created_at.localeCompare(b.created_at),
		);

	const sections: MarketSection[] = [];
	for (const supermarket of orderedSupermarkets) {
		const entries = bySupermarket.get(supermarket.id);
		if (entries)
			sections.push({ supermarket, entries: entries.sort(byCategoryOrder) });
	}
	const unassigned = bySupermarket.get(null);
	if (unassigned)
		sections.push({
			supermarket: null,
			entries: unassigned.sort(byCategoryOrder),
		});

	return sections;
}
