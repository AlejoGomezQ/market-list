import { describe, expect, it } from "vitest";
import type { Category, Product } from "@/schemas/domain";
import { buildDeleteCategory, buildReorderCategory } from "./categories";

const hh = "11111111-1111-1111-1111-111111111111";
const ts = "2026-09-06T10:00:00.000Z";

function category(overrides: Partial<Category> = {}): Category {
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

function product(overrides: Partial<Product> = {}): Product {
	return {
		id: "p-1",
		household_id: hh,
		name: "Leche",
		brand: null,
		category_id: "cat-1",
		supermarket_id: null,
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: {},
		...overrides,
	};
}

describe("buildDeleteCategory", () => {
	it("tombstones the category and clears category_id on its live products (D-004, by symmetry with D-002)", () => {
		const products = [
			product({ id: "p-1", category_id: "cat-1" }),
			product({ id: "p-other", category_id: "cat-other" }),
		];
		const patches = buildDeleteCategory(category(), products, ts);
		expect(patches).toEqual([
			{ entity: "categories", id: "cat-1", ts, fields: { deleted_at: ts } },
			{ entity: "products", id: "p-1", ts, fields: { category_id: null } },
		]);
	});
});

describe("buildReorderCategory", () => {
	const categories = [
		category({ id: "cat-a", name: "A", position: 0 }),
		category({ id: "cat-b", name: "B", position: 1 }),
		category({ id: "cat-c", name: "C", position: 2 }),
	];

	it("swaps positions with the previous live category on 'up'", () => {
		const patches = buildReorderCategory(categories, "cat-b", "up", ts);
		expect(patches).toEqual([
			{ entity: "categories", id: "cat-b", ts, fields: { position: 0 } },
			{ entity: "categories", id: "cat-a", ts, fields: { position: 1 } },
		]);
	});

	it("swaps positions with the next live category on 'down'", () => {
		const patches = buildReorderCategory(categories, "cat-b", "down", ts);
		expect(patches).toEqual([
			{ entity: "categories", id: "cat-b", ts, fields: { position: 2 } },
			{ entity: "categories", id: "cat-c", ts, fields: { position: 1 } },
		]);
	});

	it("does nothing at either end of the list", () => {
		expect(buildReorderCategory(categories, "cat-a", "up", ts)).toEqual([]);
		expect(buildReorderCategory(categories, "cat-c", "down", ts)).toEqual([]);
	});

	it("skips deleted categories when finding neighbours", () => {
		const withDeleted = [
			category({ id: "cat-a", position: 0 }),
			category({ id: "cat-deleted", position: 1, deleted_at: ts }),
			category({ id: "cat-c", position: 2 }),
		];
		const patches = buildReorderCategory(withDeleted, "cat-c", "up", ts);
		expect(patches).toEqual([
			{ entity: "categories", id: "cat-c", ts, fields: { position: 0 } },
			{ entity: "categories", id: "cat-a", ts, fields: { position: 2 } },
		]);
	});
});
