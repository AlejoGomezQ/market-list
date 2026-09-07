import { describe, expect, it } from "vitest";
import type { Product, Supermarket } from "@/schemas/domain";
import {
	buildCreateSupermarket,
	buildDeleteSupermarket,
	buildRenameSupermarket,
} from "./supermarkets";

const hh = "11111111-1111-1111-1111-111111111111";
const ts = "2026-09-06T10:00:00.000Z";

function supermarket(overrides: Partial<Supermarket> = {}): Supermarket {
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

function product(overrides: Partial<Product> = {}): Product {
	return {
		id: "p-1",
		household_id: hh,
		name: "Leche",
		brand: null,
		category_id: null,
		supermarket_id: "sm-1",
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: {},
		...overrides,
	};
}

describe("buildCreateSupermarket", () => {
	it("builds a local row and a sync_push alta patch carrying household_id in fields (RF-004)", () => {
		const { row, patch } = buildCreateSupermarket(hh, "D1", 1, ts, "sm-new");
		expect(row).toMatchObject({
			id: "sm-new",
			household_id: hh,
			name: "D1",
			position: 1,
			deleted_at: null,
		});
		expect(patch).toEqual({
			entity: "supermarkets",
			id: "sm-new",
			ts,
			fields: { household_id: hh, name: "D1", position: 1 },
		});
	});
});

describe("buildRenameSupermarket", () => {
	it("sends only the name field", () => {
		const patch = buildRenameSupermarket(supermarket(), "D1", ts);
		expect(patch).toEqual({
			entity: "supermarkets",
			id: "sm-1",
			ts,
			fields: { name: "D1" },
		});
	});
});

describe("buildDeleteSupermarket", () => {
	it("tombstones the supermarket and reassigns its live products to Sin asignar (RF-006, D-002)", () => {
		const products = [
			product({ id: "p-1", supermarket_id: "sm-1" }),
			product({ id: "p-2", supermarket_id: "sm-1" }),
			product({ id: "p-other", supermarket_id: "sm-other" }),
		];
		const patches = buildDeleteSupermarket(supermarket(), products, ts);

		expect(patches).toEqual([
			{ entity: "supermarkets", id: "sm-1", ts, fields: { deleted_at: ts } },
			{
				entity: "products",
				id: "p-1",
				ts,
				fields: { supermarket_id: null },
			},
			{
				entity: "products",
				id: "p-2",
				ts,
				fields: { supermarket_id: null },
			},
		]);
	});

	it("skips products already deleted, so a tombstone doesn't come back to life", () => {
		const products = [
			product({ id: "p-gone", supermarket_id: "sm-1", deleted_at: ts }),
		];
		const patches = buildDeleteSupermarket(supermarket(), products, ts);
		expect(patches).toEqual([
			{ entity: "supermarkets", id: "sm-1", ts, fields: { deleted_at: ts } },
		]);
	});
});
