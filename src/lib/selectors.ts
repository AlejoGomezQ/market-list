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
	// Igual que con el supermercado borrado (§4.3): una categoría borrada no debe congelar su
	// posición para siempre. Un producto que apuntaba a ella cae al final del grupo, como si no
	// tuviera categoría, en vez de ordenarse por una posición fantasma.
	const categoryPosition = new Map(
		categories
			.filter((c) => c.deleted_at === null)
			.map((c) => [c.id, c.position]),
	);

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

/**
 * Dentro de una sección del Mercado, los marcados bajan al final (D-009), tras el orden por
 * categoría que ya trae `groupMarketListBySupermarket`: se parte en dos grupos preservando ese
 * orden relativo, en vez de volver a ordenar. `MercadoScreen` pinta `pending` y, si no está vacío,
 * `checked` después de un separador.
 */
export function splitByChecked<T extends { item: ListItem }>(
	entries: T[],
): { pending: T[]; checked: T[] } {
	return {
		pending: entries.filter((entry) => !entry.item.checked),
		checked: entries.filter((entry) => entry.item.checked),
	};
}

export interface CatalogSection {
	/** `null` es el grupo "Sin asignar" (D-002). */
	supermarket: Supermarket | null;
	products: Product[];
}

/**
 * Agrupa el catálogo completo por supermercado (experiencia_usuario §5), con el mismo criterio de
 * pintado que el Mercado (§4.3 de la arquitectura): un producto sin supermercado, o cuyo
 * supermercado está borrado, cae en "Sin asignar". A diferencia de `groupMarketListBySupermarket`
 * entra todo el catálogo vivo, no solo lo que está en la lista de mercado, y el orden dentro de
 * cada grupo es alfabético: aquí no se recorre un pasillo, se busca un nombre.
 */
export function groupProductsBySupermarket(
	products: Product[],
	supermarkets: Supermarket[],
): CatalogSection[] {
	const liveSupermarketById = new Map(
		supermarkets.filter((s) => s.deleted_at === null).map((s) => [s.id, s]),
	);
	const bySupermarket = new Map<string | null, Product[]>();

	for (const product of products) {
		if (product.deleted_at !== null) continue;
		const supermarketId =
			product.supermarket_id && liveSupermarketById.has(product.supermarket_id)
				? product.supermarket_id
				: null;
		const list = bySupermarket.get(supermarketId) ?? [];
		list.push(product);
		bySupermarket.set(supermarketId, list);
	}

	const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, "es");

	const orderedSupermarkets = [...supermarkets]
		.filter((s) => s.deleted_at === null)
		.sort(
			(a, b) =>
				a.position - b.position || a.created_at.localeCompare(b.created_at),
		);

	const sections: CatalogSection[] = [];
	for (const supermarket of orderedSupermarkets) {
		const list = bySupermarket.get(supermarket.id);
		if (list) sections.push({ supermarket, products: list.sort(byName) });
	}
	const unassigned = bySupermarket.get(null);
	if (unassigned)
		sections.push({ supermarket: null, products: unassigned.sort(byName) });

	return sections;
}

/** Siguiente `position` libre al dar de alta una fila en una tabla ordenable (supermercados,
 * categorías): el máximo actual más uno, o 0 si la tabla está vacía. */
export function nextPosition(rows: Array<{ position: number }>): number {
	return rows.length === 0
		? 0
		: Math.max(...rows.map((row) => row.position)) + 1;
}

/**
 * Paleta cerrada de ocho (identidad_visual_v0.1.md #2, D-036). No hay columna `color` en el
 * dominio (arquitectura §2.2): el color se deriva de `position` en el momento de pintar, no se
 * guarda. Así cada supermercado conserva su color aunque se borren otros -- "se asignan por orden
 * al crear" (D-036) sin que la paleta se reordene sola -- y con más de ocho supermercados la
 * paleta simplemente se repite en vez de fallar.
 */
const SUPERMARKET_COLOR_CLASSES = [
	"bg-market-rojo",
	"bg-market-cobalto",
	"bg-market-bosque",
	"bg-market-ocre",
	"bg-market-ciruela",
	"bg-market-turquesa",
	"bg-market-pizarra",
	"bg-market-naranja",
] as const;

export function supermarketColorClass(position: number): string {
	const length = SUPERMARKET_COLOR_CLASSES.length;
	const index = ((position % length) + length) % length;
	return SUPERMARKET_COLOR_CLASSES[index];
}

/** Normaliza un nombre para compararlo: sin espacios sobrantes, minúsculas y sin tildes. */
function normalizeProductName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/**
 * Detecta si `name` se parece a un producto ya existente en el catálogo (D-006, RF-001): avisa,
 * no bloquea, para que el catálogo no degenere en "Leche" / "leche" / "Leche Alpina". Dos nombres
 * cuentan como parecidos si, normalizados, son iguales o uno contiene enteramente al otro (cubre
 * "Leche" ⊂ "Leche Alpina"); se exige un mínimo de tres caracteres en el más corto para no marcar
 * como parecido cualquier nombre de dos letras. Ignora productos borrados y, en edición, al propio
 * producto que se está editando (`excludeId`).
 */
export function findSimilarProduct(
	products: Product[],
	name: string,
	excludeId?: string,
): Product | null {
	const normalized = normalizeProductName(name);
	if (normalized.length < 3) return null;
	for (const product of products) {
		if (product.deleted_at !== null || product.id === excludeId) continue;
		const candidate = normalizeProductName(product.name);
		if (candidate.length < 3) continue;
		if (
			candidate === normalized ||
			candidate.includes(normalized) ||
			normalized.includes(candidate)
		) {
			return product;
		}
	}
	return null;
}
