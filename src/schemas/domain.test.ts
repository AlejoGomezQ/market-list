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
});
