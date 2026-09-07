import { describe, expect, it } from "vitest";
import { applyLocalPatch } from "./optimistic";
import { mergeRemoteRow, type SyncedRow } from "./reducer";

const productId = "p-1";

function activeListItem(overrides: Partial<SyncedRow> = {}): SyncedRow {
	return {
		id: "li-1",
		household_id: "hh-1",
		product_id: productId,
		quantity: 1,
		checked: false,
		checked_at: null,
		updated_at: "2026-09-06T10:00:00.000Z",
		removed_at: null,
		removed_reason: null,
		field_updated_at: {},
		...overrides,
	};
}

describe("escritura optimista end-to-end (plan_implementacion Fase 2a, punto 7)", () => {
	it("pinta el marcado de inmediato con applyLocalPatch", () => {
		const local = activeListItem();
		const ts = "2026-09-06T10:04:11.000Z";

		const optimistic = applyLocalPatch(local, {
			ts,
			fields: { checked: true, checked_at: ts },
		});

		expect(optimistic.checked).toBe(true);
		expect(optimistic.checked_at).toBe(ts);
		expect(optimistic.field_updated_at.checked).toBe(ts);
	});

	it("el eco de la propia escritura, procesado por el mismo reductor, no revierte lo ya pintado", () => {
		// 1) El usuario marca el producto: escritura optimista inmediata, parche encolado con ts=T1.
		const t1 = "2026-09-06T10:04:11.000Z";
		const afterOptimisticWrite = applyLocalPatch(activeListItem(), {
			ts: t1,
			fields: { checked: true, checked_at: t1 },
		});
		expect(afterOptimisticWrite.checked).toBe(true);

		// 2) Antes de que sync_push confirme, el usuario lo vuelve a desmarcar: segundo parche
		//    optimista con ts=T2, todavía en cola.
		const t2 = "2026-09-06T10:04:30.000Z";
		const afterSecondOptimisticWrite = applyLocalPatch(afterOptimisticWrite, {
			ts: t2,
			fields: { checked: false, checked_at: null },
		});
		expect(afterSecondOptimisticWrite.checked).toBe(false);

		// 3) El eco de la PRIMERA escritura (T1, checked=true) vuelve por Realtime -- el mismo
		//    reductor que procesaría cualquier fila remota (reducer.ts, estrategia_sincronizacion
		//    §6.2). Como T1 < T2 (el field_updated_at local ya está en T2), el eco se descarta.
		const echoOfFirstWrite: SyncedRow = {
			...afterSecondOptimisticWrite,
			checked: true,
			checked_at: t1,
			field_updated_at: { checked: t1, checked_at: t1 },
		};

		const afterEcho = mergeRemoteRow(
			afterSecondOptimisticWrite,
			echoOfFirstWrite,
		);

		expect(afterEcho.checked).toBe(false);
		expect(afterEcho.field_updated_at.checked).toBe(t2);
	});
});
