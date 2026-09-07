import { describe, expect, it } from "vitest";
import type { ListItem, Product } from "@/schemas/domain";
import {
	buildAddToList,
	buildFinalizePurchase,
	buildRemoveFromList,
	buildSetQuantity,
	buildUndoFinalize,
} from "./list-items";

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

describe("buildAddToList", () => {
	it("declara una intención con quantity 1, sin checked (D-010, RN-006)", () => {
		const { row, patch } = buildAddToList(hh, product(), ts, "li-new");
		expect(row.quantity).toBe(1);
		expect(row.checked).toBe(false);
		expect(row.removed_at).toBeNull();
		expect(patch.entity).toBe("list_items");
		expect(patch.fields).toEqual({
			household_id: hh,
			product_id: "p-1",
			quantity: 1,
			checked: false,
		});
	});
});

describe("buildSetQuantity / buildRemoveFromList", () => {
	it("cambiar cantidad es un parche de un solo campo (RF-011)", () => {
		const patch = buildSetQuantity(listItem({ quantity: 1 }), 2, ts);
		expect(patch.fields).toEqual({ quantity: 2 });
	});

	it("quitar de la lista es removed_at + removed_reason: 'removed' (RF-010)", () => {
		const patch = buildRemoveFromList(listItem(), ts);
		expect(patch.fields).toEqual({ removed_at: ts, removed_reason: "removed" });
	});
});

describe("buildFinalizePurchase (RF-017, D-001)", () => {
	it("solo toca los ids explícitos que recibe, no reconsulta 'todo lo marcado'", () => {
		const markedAtClick = ["li-1", "li-2"];
		const patches = buildFinalizePurchase(markedAtClick, ts);

		expect(patches).toHaveLength(2);
		expect(patches.map((p) => p.id)).toEqual(["li-1", "li-2"]);
		for (const patch of patches) {
			expect(patch.entity).toBe("list_items");
			expect(patch.fields).toEqual({
				removed_at: ts,
				removed_reason: "purchased",
			});
		}
	});

	it("C-002: un item agregado o marcado después de capturar el conjunto no aparece en el lote", () => {
		// Al pulsar "Finalizar compra" se captura el conjunto marcado en ESE instante (li-1). Un
		// producto que el otro dispositivo agrega y marca mientras la confirmación está abierta
		// (li-9, aquí simulado) nunca entra en `itemIds`, así que nunca puede entrar en el lote --
		// la exclusión es estructural, no una condición que se re-evalúe al confirmar.
		const capturedAtClick = ["li-1"];
		const patches = buildFinalizePurchase(capturedAtClick, ts);
		expect(patches.map((p) => p.id)).not.toContain("li-9");
		expect(patches).toHaveLength(1);
	});

	it("no produce ningún parche si no había nada marcado", () => {
		expect(buildFinalizePurchase([], ts)).toEqual([]);
	});
});

describe("buildUndoFinalize (D-032)", () => {
	it("restaura exactamente el mismo conjunto de ids que se finalizó, poniendo removed_at a null", () => {
		const ts2 = "2026-09-06T10:05:00.000Z";
		const finalizedIds = buildFinalizePurchase(["li-1", "li-2"], ts).map(
			(p) => p.id,
		);
		const patches = buildUndoFinalize(finalizedIds, ts2);

		expect(patches.map((p) => p.id)).toEqual(["li-1", "li-2"]);
		for (const patch of patches) {
			expect(patch.fields).toEqual({ removed_at: null });
			// El timestamp del deshacer es posterior al de la finalización: es lo que le hace ganar
			// el LWW en sync_apply_list_item_patch (removed_at no es lápida absorbente, C-006).
			expect(patch.ts > ts).toBe(true);
		}
	});
});
