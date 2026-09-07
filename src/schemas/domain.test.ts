import { describe, expect, it } from "vitest";
import { listItemSchema, productSchema } from "./domain";

const ts = "2026-09-06T10:04:11.000Z";
const id = "b2f2c9c0-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

describe("productSchema", () => {
	it("accepts brand and supermarket as null (D-002, D-005)", () => {
		const result = productSchema.safeParse({
			id,
			household_id: id,
			name: "Leche",
			brand: null,
			category_id: null,
			supermarket_id: null,
			created_at: ts,
			updated_at: ts,
			deleted_at: null,
			field_updated_at: {},
		});
		expect(result.success).toBe(true);
	});
});

describe("listItemSchema", () => {
	it("rejects quantity <= 0 (RF-011 / D-010, check quantity > 0)", () => {
		const result = listItemSchema.safeParse({
			id,
			household_id: id,
			product_id: id,
			quantity: 0,
			checked: false,
			checked_at: null,
			created_at: ts,
			updated_at: ts,
			removed_at: null,
			removed_reason: null,
			field_updated_at: {},
		});
		expect(result.success).toBe(false);
	});

	it("rejects a removed_reason outside purchased/removed", () => {
		const result = listItemSchema.safeParse({
			id,
			household_id: id,
			product_id: id,
			quantity: 1,
			checked: false,
			checked_at: null,
			created_at: ts,
			updated_at: ts,
			removed_at: ts,
			removed_reason: "expired",
			field_updated_at: {},
		});
		expect(result.success).toBe(false);
	});

	// Historial V2 (CAMINO A): purchase_batch_id / purchase_total.
	function base(overrides: Record<string, unknown> = {}) {
		return {
			id,
			household_id: id,
			product_id: id,
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

	it("accepts purchase_batch_id / purchase_total as null (item no comprado)", () => {
		expect(listItemSchema.safeParse(base()).success).toBe(true);
	});

	it("accepts a uuid purchase_batch_id and a non-negative purchase_total", () => {
		const result = listItemSchema.safeParse(
			base({
				removed_at: ts,
				removed_reason: "purchased",
				purchase_batch_id: id,
				purchase_total: 42.5,
			}),
		);
		expect(result.success).toBe(true);
	});

	it("accepts purchase_total 0", () => {
		expect(listItemSchema.safeParse(base({ purchase_total: 0 })).success).toBe(
			true,
		);
	});

	it("rejects a negative purchase_total", () => {
		expect(listItemSchema.safeParse(base({ purchase_total: -1 })).success).toBe(
			false,
		);
	});

	it("rejects a non-numeric purchase_total", () => {
		expect(
			listItemSchema.safeParse(base({ purchase_total: "10" })).success,
		).toBe(false);
	});

	it("rejects a non-uuid purchase_batch_id", () => {
		expect(
			listItemSchema.safeParse(base({ purchase_batch_id: "not-a-uuid" }))
				.success,
		).toBe(false);
	});
});
