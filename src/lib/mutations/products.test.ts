import { describe, expect, it } from "vitest";
import type { ListItem, Product } from "@/schemas/domain";
import {
	buildCreateProduct,
	buildDeleteProduct,
	buildUpdateProduct,
} from "./products";

const hh = "11111111-1111-1111-1111-111111111111";
const ts = "2026-09-06T10:00:00.000Z";

function product(overrides: Partial<Product> = {}): Product {
	return {
		id: "p-1",
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

function listItem(overrides: Partial<ListItem> = {}): ListItem {
	return {
		id: "li-1",
		household_id: hh,
		product_id: "p-1",
		quantity: 1,
		checked: false,
		checked_at: null,
		created_at: ts,
		updated_at: ts,
		removed_at: null,
		removed_reason: null,
		field_updated_at: {},
		...overrides,
	};
}

describe("buildCreateProduct", () => {
	it("never creates a list_item -- creating a product doesn't add it to the shopping list (RN-001)", () => {
		const { row, patch } = buildCreateProduct(
			hh,
			{ name: "Leche", brand: "Alpina", categoryId: null, supermarketId: null },
			ts,
			"p-new",
		);
		expect(row.id).toBe("p-new");
		expect(patch.entity).toBe("products");
		expect(patch.fields).toEqual({
			household_id: hh,
			name: "Leche",
			brand: "Alpina",
			category_id: null,
			supermarket_id: null,
		});
	});
});

describe("buildUpdateProduct", () => {
	it("sends only the changed fields, never the whole row", () => {
		const patch = buildUpdateProduct(product(), { brand: "Alqueria" }, ts);
		expect(patch).toEqual({
			entity: "products",
			id: "p-1",
			ts,
			fields: { brand: "Alqueria" },
		});
	});
});

describe("buildDeleteProduct", () => {
	it("tombstones only the product when it has no active list item", () => {
		const patches = buildDeleteProduct(product(), null, ts);
		expect(patches).toEqual([
			{ entity: "products", id: "p-1", ts, fields: { deleted_at: ts } },
		]);
	});

	it("also retires the active list item, with removed_reason 'removed' (RF-003, C-004)", () => {
		const patches = buildDeleteProduct(product(), listItem({ id: "li-1" }), ts);
		expect(patches).toEqual([
			{ entity: "products", id: "p-1", ts, fields: { deleted_at: ts } },
			{
				entity: "list_items",
				id: "li-1",
				ts,
				fields: { removed_at: ts, removed_reason: "removed" },
			},
		]);
	});
});
