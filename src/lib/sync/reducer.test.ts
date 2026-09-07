import { describe, expect, it } from "vitest";
import { mergeRemoteRow, type SyncedRow } from "./reducer";

function row(overrides: Partial<SyncedRow> = {}): SyncedRow {
	return {
		id: "item-1",
		updated_at: "2026-09-06T10:00:00.000Z",
		field_updated_at: {},
		name: "Leche",
		...overrides,
	};
}

describe("mergeRemoteRow", () => {
	it("accepts the remote row entirely when there is no local row yet (delta pull / primer arranque)", () => {
		const remote = row({
			field_updated_at: { name: "2026-09-06T10:00:00.000Z" },
		});
		expect(mergeRemoteRow(undefined, remote)).toEqual(remote);
	});

	it("applies a remote field newer than the local one (§6.2, upsert por id)", () => {
		const local = row({
			name: "Leche",
			field_updated_at: { name: "2026-09-06T10:00:00.000Z" },
		});
		const remote = row({
			name: "Leche entera",
			field_updated_at: { name: "2026-09-06T10:05:00.000Z" },
		});
		expect(mergeRemoteRow(local, remote).name).toBe("Leche entera");
	});

	it("discards a remote field older than the local one -- el eco de la propia escritura (§6.2)", () => {
		// El usuario marcó el producto (checked=true a las 10:00) y ANTES de que el eco vuelva por
		// Realtime, lo desmarcó otra vez (checked=false a las 10:01, todavía en cola). El eco trae
		// la versión de las 10:00 -- más vieja que el estado local -- y no debe revertir el segundo
		// toque.
		const local = row({
			checked: false,
			field_updated_at: { checked: "2026-09-06T10:01:00.000Z" },
		});
		const echo = row({
			checked: true,
			field_updated_at: { checked: "2026-09-06T10:00:00.000Z" },
		});

		const result = mergeRemoteRow(local, echo);

		expect(result.checked).toBe(false);
		expect(result.field_updated_at.checked).toBe("2026-09-06T10:01:00.000Z");
	});

	it("keeps fields untouched by the incoming payload (C-003, editar campos distintos no se pisa)", () => {
		const local = row({
			name: "Leche",
			brand: "Alqueria",
			field_updated_at: {
				name: "2026-09-06T09:00:00.000Z",
				brand: "2026-09-06T09:30:00.000Z",
			},
		});
		const remote = row({
			name: "Leche deslactosada",
			brand: "Alqueria",
			field_updated_at: { name: "2026-09-06T10:00:00.000Z" },
		});

		const result = mergeRemoteRow(local, remote);

		expect(result.name).toBe("Leche deslactosada");
		expect(result.brand).toBe("Alqueria");
		expect(result.field_updated_at.brand).toBe("2026-09-06T09:30:00.000Z");
	});

	it("never moves updated_at (el cursor) hacia atrás", () => {
		const local = row({ updated_at: "2026-09-06T10:05:00.000Z" });
		const staleRemote = row({ updated_at: "2026-09-06T10:00:00.000Z" });
		expect(mergeRemoteRow(local, staleRemote).updated_at).toBe(
			"2026-09-06T10:05:00.000Z",
		);
	});
});
