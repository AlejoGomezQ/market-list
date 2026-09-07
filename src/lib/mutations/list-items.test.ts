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
		purchase_batch_id: null,
		purchase_total: null,
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

const batch = "99999999-9999-9999-9999-999999999999";

describe("buildFinalizePurchase (RF-017, D-001)", () => {
	it("solo toca los ids explícitos que recibe, no reconsulta 'todo lo marcado'", () => {
		const markedAtClick = ["li-1", "li-2"];
		const patches = buildFinalizePurchase(markedAtClick, ts, batch);

		expect(patches).toHaveLength(2);
		expect(patches.map((p) => p.id)).toEqual(["li-1", "li-2"]);
		for (const patch of patches) {
			expect(patch.entity).toBe("list_items");
			expect(patch.fields).toEqual({
				removed_at: ts,
				removed_reason: "purchased",
				purchase_batch_id: batch,
			});
		}
	});

	it("todos los items del lote comparten el mismo purchase_batch_id", () => {
		const patches = buildFinalizePurchase(["li-1", "li-2", "li-3"], ts, batch);
		const batchIds = new Set(patches.map((p) => p.fields.purchase_batch_id));
		expect(batchIds).toEqual(new Set([batch]));
	});

	it("con total: purchase_total viaja en cada parche del lote (backlog §6)", () => {
		const patches = buildFinalizePurchase(["li-1", "li-2"], ts, batch, 57.3);
		for (const patch of patches) {
			expect(patch.fields).toEqual({
				removed_at: ts,
				removed_reason: "purchased",
				purchase_batch_id: batch,
				purchase_total: 57.3,
			});
		}
	});

	it("sin total (null / undefined): la clave purchase_total no aparece", () => {
		for (const patches of [
			buildFinalizePurchase(["li-1"], ts, batch),
			buildFinalizePurchase(["li-1"], ts, batch, null),
		]) {
			expect(patches[0].fields).not.toHaveProperty("purchase_total");
			expect(patches[0].fields.purchase_batch_id).toBe(batch);
		}
	});

	it("C-002: un item agregado o marcado después de capturar el conjunto no aparece en el lote", () => {
		// Al pulsar "Finalizar compra" se captura el conjunto marcado en ESE instante (li-1). Un
		// producto que el otro dispositivo agrega y marca mientras la confirmación está abierta
		// (li-9, aquí simulado) nunca entra en `itemIds`, así que nunca puede entrar en el lote --
		// la exclusión es estructural, no una condición que se re-evalúe al confirmar.
		const capturedAtClick = ["li-1"];
		const patches = buildFinalizePurchase(capturedAtClick, ts, batch);
		expect(patches.map((p) => p.id)).not.toContain("li-9");
		expect(patches).toHaveLength(1);
	});

	it("no produce ningún parche si no había nada marcado", () => {
		expect(buildFinalizePurchase([], ts, batch)).toEqual([]);
	});
});

describe("buildUndoFinalize (D-032)", () => {
	it("restaura los mismos ids poniendo removed_at, purchase_batch_id y purchase_total a null", () => {
		const ts2 = "2026-09-06T10:05:00.000Z";
		const finalizedIds = buildFinalizePurchase(["li-1", "li-2"], ts, batch).map(
			(p) => p.id,
		);
		const patches = buildUndoFinalize(finalizedIds, ts2);

		expect(patches.map((p) => p.id)).toEqual(["li-1", "li-2"]);
		for (const patch of patches) {
			expect(patch.fields).toEqual({
				removed_at: null,
				purchase_batch_id: null,
				purchase_total: null,
			});
			// El timestamp del deshacer es posterior al de la finalización: es lo que le hace ganar
			// el LWW en sync_apply_list_item_patch (removed_at no es lápida absorbente, C-006).
			expect(patch.ts > ts).toBe(true);
		}
	});
});
