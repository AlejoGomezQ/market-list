import { describe, expect, it } from "vitest";
import type {
	Category,
	ListItem,
	Product,
	Supermarket,
} from "@/schemas/domain";
import {
	findSimilarProduct,
	formatMarketListForSharing,
	groupMarketListBySupermarket,
	groupProductsBySupermarket,
	groupPurchaseHistory,
	indexActiveListItemsByProduct,
	nextPosition,
	searchProducts,
	splitByChecked,
	supermarketColorClass,
} from "./selectors";

const ts = "2026-09-06T10:00:00.000Z";
const hh = "11111111-1111-1111-1111-111111111111";

function supermarket(overrides: Partial<Supermarket>): Supermarket {
	return {
		id: "sm-1",
		household_id: hh,
		name: "Supermu",
		position: 0,
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: {},
		...overrides,
	};
}

function category(overrides: Partial<Category>): Category {
	return {
		id: "cat-1",
		household_id: hh,
		name: "Lácteos",
		position: 0,
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: {},
		...overrides,
	};
}

function product(overrides: Partial<Product>): Product {
	return {
		id: "prod-1",
		household_id: hh,
		name: "Leche",
		brand: null,
		category_id: null,
		supermarket_id: null,
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: {},
		...overrides,
	};
}

function listItem(overrides: Partial<ListItem>): ListItem {
	return {
		id: "li-1",
		household_id: hh,
		product_id: "prod-1",
		quantity: 1,
		checked: false,
		checked_at: null,
		created_at: ts,
		updated_at: ts,
		removed_at: null,
		removed_reason: null,
		purchase_batch_id: null,
		purchase_total: null,
		field_updated_at: {},
		...overrides,
	};
}

describe("indexActiveListItemsByProduct", () => {
	it("indexes by product_id, not by the item's own id (CLAUDE.md, C-005)", () => {
		const item = listItem({ id: "li-1", product_id: "prod-9" });
		const byProduct = indexActiveListItemsByProduct([item]);
		expect(byProduct.get("prod-9")).toBe(item);
		expect(byProduct.get("li-1")).toBeUndefined();
	});

	it("excludes removed items -- at most one active per product (índice único parcial de la Fase 1)", () => {
		const removed = listItem({
			id: "li-old",
			product_id: "prod-1",
			removed_at: ts,
			removed_reason: "purchased",
		});
		const active = listItem({ id: "li-new", product_id: "prod-1" });
		const byProduct = indexActiveListItemsByProduct([removed, active]);
		expect(byProduct.size).toBe(1);
		expect(byProduct.get("prod-1")).toBe(active);
	});
});

describe("splitByChecked", () => {
	it("separates pending and checked, keeping the relative order of each group (D-009)", () => {
		const a = { item: listItem({ id: "li-a", checked: false }) };
		const b = { item: listItem({ id: "li-b", checked: true }) };
		const c = { item: listItem({ id: "li-c", checked: false }) };
		const d = { item: listItem({ id: "li-d", checked: true }) };

		const { pending, checked } = splitByChecked([a, b, c, d]);

		expect(pending.map((e) => e.item.id)).toEqual(["li-a", "li-c"]);
		expect(checked.map((e) => e.item.id)).toEqual(["li-b", "li-d"]);
	});
});

describe("searchProducts", () => {
	const products = [
		product({ id: "p1", name: "Leche entera", brand: "Alqueria" }),
		product({ id: "p2", name: "Pan tajado", brand: null }),
	];

	it("matches by name, case-insensitive", () => {
		expect(searchProducts(products, "leche")).toEqual([products[0]]);
	});

	it("matches by brand when the name doesn't match", () => {
		expect(searchProducts(products, "alqueria")).toEqual([products[0]]);
	});

	it("returns everything for an empty/blank query", () => {
		expect(searchProducts(products, "   ")).toEqual(products);
	});

	it("tolerates a null brand without throwing", () => {
		expect(searchProducts(products, "pan")).toEqual([products[1]]);
	});
});

describe("groupMarketListBySupermarket", () => {
	it("groups by supermarket and orders each group by category position (D-007, D-031)", () => {
		const supermarkets = [
			supermarket({ id: "sm-1", name: "Supermu", position: 0 }),
		];
		const categories = [
			category({ id: "cat-lacteos", name: "Lácteos", position: 0 }),
			category({ id: "cat-limpieza", name: "Limpieza", position: 1 }),
		];
		const products = [
			product({
				id: "p-jabon",
				name: "Jabón",
				category_id: "cat-limpieza",
				supermarket_id: "sm-1",
			}),
			product({
				id: "p-leche",
				name: "Leche",
				category_id: "cat-lacteos",
				supermarket_id: "sm-1",
			}),
		];
		const listItems = [
			listItem({ id: "li-jabon", product_id: "p-jabon" }),
			listItem({ id: "li-leche", product_id: "p-leche" }),
		];

		const sections = groupMarketListBySupermarket(
			listItems,
			products,
			supermarkets,
			categories,
		);

		expect(sections).toHaveLength(1);
		expect(sections[0].supermarket?.name).toBe("Supermu");
		expect(sections[0].entries.map((e) => e.product.name)).toEqual([
			"Leche",
			"Jabón",
		]);
	});

	it('puts products without a supermarket, or whose supermarket is deleted, in "Sin asignar" (D-002, §4.3)', () => {
		const supermarkets = [supermarket({ id: "sm-deleted", deleted_at: ts })];
		const products = [
			product({ id: "p-none", name: "Sal", supermarket_id: null }),
			product({
				id: "p-deleted-sm",
				name: "Azúcar",
				supermarket_id: "sm-deleted",
			}),
		];
		const listItems = [
			listItem({ id: "li-1", product_id: "p-none" }),
			listItem({ id: "li-2", product_id: "p-deleted-sm" }),
		];

		const sections = groupMarketListBySupermarket(
			listItems,
			products,
			supermarkets,
			[],
		);

		expect(sections).toHaveLength(1);
		expect(sections[0].supermarket).toBeNull();
		expect(sections[0].entries.map((e) => e.product.name).sort()).toEqual([
			"Azúcar",
			"Sal",
		]);
	});

	it("skips items whose product is deleted (fila fantasma, §4.3)", () => {
		const products = [product({ id: "p-gone", deleted_at: ts })];
		const listItems = [listItem({ id: "li-1", product_id: "p-gone" })];

		const sections = groupMarketListBySupermarket(listItems, products, [], []);

		expect(sections).toHaveLength(0);
	});

	it("puts products without category at the end of their group", () => {
		const supermarkets = [supermarket({ id: "sm-1" })];
		const categories = [category({ id: "cat-1", position: 0 })];
		const products = [
			product({
				id: "p-none",
				name: "Sin categoría",
				category_id: null,
				supermarket_id: "sm-1",
			}),
			product({
				id: "p-cat",
				name: "Con categoría",
				category_id: "cat-1",
				supermarket_id: "sm-1",
			}),
		];
		const listItems = [
			listItem({ id: "li-1", product_id: "p-none" }),
			listItem({ id: "li-2", product_id: "p-cat" }),
		];

		const sections = groupMarketListBySupermarket(
			listItems,
			products,
			supermarkets,
			categories,
		);

		expect(sections[0].entries.map((e) => e.product.name)).toEqual([
			"Con categoría",
			"Sin categoría",
		]);
	});

	it("treats a product pointing to a deleted category as uncategorized, not frozen in place", () => {
		const supermarkets = [supermarket({ id: "sm-1" })];
		const categories = [
			category({ id: "cat-live", name: "Lácteos", position: 0 }),
			category({
				id: "cat-deleted",
				name: "Vieja",
				position: 1,
				deleted_at: ts,
			}),
		];
		const products = [
			product({
				id: "p-deleted-cat",
				name: "Azúcar",
				category_id: "cat-deleted",
				supermarket_id: "sm-1",
			}),
			product({
				id: "p-cat",
				name: "Leche",
				category_id: "cat-live",
				supermarket_id: "sm-1",
			}),
		];
		const listItems = [
			listItem({ id: "li-1", product_id: "p-deleted-cat" }),
			listItem({ id: "li-2", product_id: "p-cat" }),
		];

		const sections = groupMarketListBySupermarket(
			listItems,
			products,
			supermarkets,
			categories,
		);

		expect(sections[0].entries.map((e) => e.product.name)).toEqual([
			"Leche",
			"Azúcar",
		]);
	});
});

describe("groupProductsBySupermarket", () => {
	it("groups the whole live catalog alphabetically within each supermarket (experiencia_usuario §5)", () => {
		const supermarkets = [supermarket({ id: "sm-1", position: 0 })];
		const products = [
			product({ id: "p-1", name: "Yogur", supermarket_id: "sm-1" }),
			product({ id: "p-2", name: "Arroz", supermarket_id: "sm-1" }),
		];
		const sections = groupProductsBySupermarket(products, supermarkets);
		expect(sections).toHaveLength(1);
		expect(sections[0].products.map((p) => p.name)).toEqual(["Arroz", "Yogur"]);
	});

	it('puts products without a supermarket, or with a deleted one, in "Sin asignar" (D-002)', () => {
		const supermarkets = [supermarket({ id: "sm-deleted", deleted_at: ts })];
		const products = [
			product({ id: "p-none", name: "Sal", supermarket_id: null }),
			product({
				id: "p-deleted-sm",
				name: "Azúcar",
				supermarket_id: "sm-deleted",
			}),
		];
		const sections = groupProductsBySupermarket(products, supermarkets);
		expect(sections).toHaveLength(1);
		expect(sections[0].supermarket).toBeNull();
	});

	it("excludes deleted products entirely (RF-003)", () => {
		const products = [product({ id: "p-gone", deleted_at: ts })];
		expect(groupProductsBySupermarket(products, [])).toHaveLength(0);
	});
});

describe("groupPurchaseHistory", () => {
	const sm = supermarket({ id: "sm-1", name: "Supermu", position: 0 });
	const leche = product({
		id: "p-leche",
		name: "Leche",
		supermarket_id: "sm-1",
	});
	const pan = product({ id: "p-pan", name: "Pan", supermarket_id: "sm-1" });

	const purchased = (over: Partial<ListItem>): ListItem =>
		listItem({
			removed_at: ts,
			removed_reason: "purchased",
			purchase_batch_id: "batch-1",
			...over,
		});

	it("groups tombstones by purchase_batch_id", () => {
		const items = [
			purchased({ id: "li-1", product_id: "p-leche", quantity: 2 }),
			purchased({ id: "li-2", product_id: "p-pan" }),
		];
		const groups = groupPurchaseHistory(items, [leche, pan], [sm]);
		expect(groups).toHaveLength(1);
		expect(groups[0].batchId).toBe("batch-1");
		expect(groups[0].supermarket?.name).toBe("Supermu");
		expect(
			groups[0].entries.map((e) => `${e.product.name} x${e.quantity}`).sort(),
		).toEqual(["Leche x2", "Pan x1"]);
	});

	it("orders groups by purchase date, most recent first", () => {
		const items = [
			purchased({
				id: "li-old",
				product_id: "p-leche",
				removed_at: "2026-09-01T10:00:00.000Z",
				purchase_batch_id: "batch-old",
			}),
			purchased({
				id: "li-new",
				product_id: "p-pan",
				removed_at: "2026-09-09T10:00:00.000Z",
				purchase_batch_id: "batch-new",
			}),
		];
		const groups = groupPurchaseHistory(items, [leche, pan], [sm]);
		expect(groups.map((g) => g.batchId)).toEqual(["batch-new", "batch-old"]);
	});

	it("keeps only 'purchased' tombstones, not 'removed' ones or active items", () => {
		const items = [
			purchased({ id: "li-p", product_id: "p-leche" }),
			listItem({
				id: "li-r",
				product_id: "p-pan",
				removed_at: ts,
				removed_reason: "removed",
			}),
			listItem({ id: "li-active", product_id: "p-pan" }),
		];
		const groups = groupPurchaseHistory(items, [leche, pan], [sm]);
		expect(groups).toHaveLength(1);
		expect(groups[0].entries.map((e) => e.product.name)).toEqual(["Leche"]);
	});

	it("shows a product that was deleted after the purchase, by its historical name", () => {
		const gone = product({
			id: "p-gone",
			name: "Yogur",
			supermarket_id: "sm-1",
			deleted_at: ts,
		});
		const items = [purchased({ id: "li-1", product_id: "p-gone" })];
		const groups = groupPurchaseHistory(items, [gone], [sm]);
		expect(groups).toHaveLength(1);
		expect(groups[0].entries[0].product.name).toBe("Yogur");
	});

	it("omits an entry whose product is gone from the catalog entirely", () => {
		const items = [
			purchased({ id: "li-1", product_id: "p-leche" }),
			purchased({ id: "li-2", product_id: "p-vanished" }),
		];
		const groups = groupPurchaseHistory(items, [leche], [sm]);
		expect(groups[0].entries.map((e) => e.product.name)).toEqual(["Leche"]);
	});

	it('puts a group with no live supermarket in "Sin asignar"', () => {
		const sal = product({ id: "p-sal", name: "Sal", supermarket_id: null });
		const items = [purchased({ id: "li-1", product_id: "p-sal" })];
		const groups = groupPurchaseHistory(items, [sal], []);
		expect(groups[0].supermarket).toBeNull();
	});

	it("reads the total from a tombstone without summing the repeated value", () => {
		const items = [
			purchased({ id: "li-1", product_id: "p-leche", purchase_total: 50000 }),
			purchased({ id: "li-2", product_id: "p-pan", purchase_total: 50000 }),
		];
		const groups = groupPurchaseHistory(items, [leche, pan], [sm]);
		expect(groups[0].total).toBe(50000);
	});

	it("falls back to grouping pre-migration tombstones by their exact removed_at", () => {
		const items = [
			listItem({
				id: "li-1",
				product_id: "p-leche",
				removed_at: "2026-09-05T10:00:00.000Z",
				removed_reason: "purchased",
				purchase_batch_id: null,
			}),
			listItem({
				id: "li-2",
				product_id: "p-pan",
				removed_at: "2026-09-05T10:00:00.000Z",
				removed_reason: "purchased",
				purchase_batch_id: null,
			}),
			listItem({
				id: "li-3",
				product_id: "p-leche",
				removed_at: "2026-09-06T11:00:00.000Z",
				removed_reason: "purchased",
				purchase_batch_id: null,
			}),
		];
		const groups = groupPurchaseHistory(items, [leche, pan], [sm]);
		expect(groups).toHaveLength(2);
		expect(groups[0].purchasedAt).toBe("2026-09-06T11:00:00.000Z");
		expect(groups[0].batchId).toBeNull();
		expect(groups[1].entries).toHaveLength(2);
	});
});

describe("formatMarketListForSharing", () => {
	const entry = (over: Partial<Product & ListItem>) => ({
		item: listItem({
			product_id: over.id ?? "prod-1",
			quantity: over.quantity ?? 1,
			checked: over.checked ?? false,
		}),
		product: product({ id: over.id ?? "prod-1", name: over.name ?? "Leche" }),
	});

	it("starts with the supermarket name in WhatsApp bold, then a blank line", () => {
		const text = formatMarketListForSharing("Supermu", [
			entry({ name: "Leche" }),
		]);
		expect(text).toBe("*Supermu*\n\n• Leche");
	});

	it("lists only pending products, excluding the checked ones", () => {
		const text = formatMarketListForSharing("Supermu", [
			entry({ id: "p1", name: "Leche", checked: false }),
			entry({ id: "p2", name: "Pan", checked: true }),
		]);
		expect(text).toBe("*Supermu*\n\n• Leche");
	});

	it("appends ' x{n}' only when quantity is greater than 1", () => {
		const text = formatMarketListForSharing("Supermu", [
			entry({ id: "p1", name: "Leche", quantity: 1 }),
			entry({ id: "p2", name: "Huevos", quantity: 12 }),
		]);
		expect(text).toBe("*Supermu*\n\n• Leche\n• Huevos x12");
	});

	it("returns just the bold header when nothing is pending", () => {
		const text = formatMarketListForSharing("Supermu", [
			entry({ name: "Leche", checked: true }),
		]);
		expect(text).toBe("*Supermu*");
	});

	it("contains no emojis", () => {
		const text = formatMarketListForSharing("Supermu", [
			entry({ id: "p1", name: "Leche", quantity: 2 }),
			entry({ id: "p2", name: "Pan" }),
		]);
		expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
	});
});

describe("nextPosition", () => {
	it("is 0 for an empty table", () => {
		expect(nextPosition([])).toBe(0);
	});

	it("is one past the current maximum", () => {
		expect(nextPosition([{ position: 0 }, { position: 3 }])).toBe(4);
	});
});

describe("supermarketColorClass", () => {
	it("assigns colors in the order supermarkets were created (D-036)", () => {
		expect(supermarketColorClass(0)).toBe("bg-market-rojo");
		expect(supermarketColorClass(1)).toBe("bg-market-cobalto");
	});

	it("cycles the closed eight-color palette instead of failing past the eighth supermarket", () => {
		expect(supermarketColorClass(8)).toBe(supermarketColorClass(0));
		expect(supermarketColorClass(9)).toBe(supermarketColorClass(1));
	});
});

describe("findSimilarProduct", () => {
	const products = [
		product({ id: "p-leche", name: "Leche" }),
		product({ id: "p-pan", name: "Pan tajado" }),
		product({ id: "p-gone", name: "Queso", deleted_at: ts }),
	];

	it("flags an exact match after normalizing case and accents (D-006)", () => {
		expect(findSimilarProduct(products, "leche")?.id).toBe("p-leche");
		expect(findSimilarProduct(products, "LECHE")?.id).toBe("p-leche");
	});

	it("flags a name that contains an existing one, e.g. adding a brand", () => {
		expect(findSimilarProduct(products, "Leche Alpina")?.id).toBe("p-leche");
	});

	it("excludes the product being edited", () => {
		expect(findSimilarProduct(products, "Leche", "p-leche")).toBeNull();
	});

	it("ignores deleted products", () => {
		expect(findSimilarProduct(products, "Queso")).toBeNull();
	});

	it("doesn't flag unrelated short names", () => {
		expect(findSimilarProduct(products, "Sal")).toBeNull();
	});
});
