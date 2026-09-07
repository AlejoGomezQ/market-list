import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { supermarketSchema } from "@/schemas/domain";
import { householdTableKey } from "./queries/household-tables";
import { applyRealtimePayload } from "./realtime";

const hh = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";

function row(overrides: Record<string, unknown> = {}) {
	return {
		id,
		household_id: hh,
		name: "Supermu",
		position: 0,
		created_at: "2026-09-06T09:00:00.000Z",
		updated_at: "2026-09-06T10:00:00.000Z",
		deleted_at: null,
		field_updated_at: { name: "2026-09-06T10:00:00.000Z" },
		...overrides,
	};
}

/**
 * Fase 6: Realtime deja de invalidar+recargar (Fase 4, "desechable a propósito") y funde en caché
 * con el mismo reductor que usa el delta pull (`sync/reducer.ts`). Se prueba `applyRealtimePayload`
 * directamente -- es la parte con lógica real de `useHouseholdRealtime`; el resto es abrir un
 * socket, que la propia Fase 4 ya documentó como no reproducible en jsdom.
 */
describe("applyRealtimePayload", () => {
	it("inserta una fila nueva sin tocarla si no había local (upsert por id)", () => {
		const queryClient = new QueryClient();
		applyRealtimePayload(
			queryClient,
			"supermarkets",
			hh,
			supermarketSchema,
			row(),
		);

		expect(
			queryClient.getQueryData(householdTableKey("supermarkets", hh)),
		).toEqual([row()]);
	});

	it("funde con la fila local existente vía mergeRemoteRow, no reemplaza la lista entera", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(householdTableKey("supermarkets", hh), [
			row({
				name: "Nombre viejo",
				field_updated_at: { name: "2026-09-06T09:00:00.000Z" },
			}),
		]);

		applyRealtimePayload(
			queryClient,
			"supermarkets",
			hh,
			supermarketSchema,
			row({ name: "Nombre nuevo" }),
		);

		const rows = queryClient.getQueryData<Array<{ name: string }>>(
			householdTableKey("supermarkets", hh),
		);
		expect(rows).toHaveLength(1);
		expect(rows?.[0]?.name).toBe("Nombre nuevo");
	});

	it("el eco de la propia escritura (un field_updated_at más viejo que el local) no revierte lo que ya está en pantalla -- §6.2, el mismo reductor que resuelve esto para el delta pull", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(householdTableKey("supermarkets", hh), [
			row({
				name: "Ya tocado localmente",
				field_updated_at: { name: "2026-09-06T10:05:00.000Z" }, // más nuevo que el eco
			}),
		]);

		applyRealtimePayload(
			queryClient,
			"supermarkets",
			hh,
			supermarketSchema,
			row({
				name: "Eco viejo",
				field_updated_at: { name: "2026-09-06T10:00:00.000Z" },
			}),
		);

		const rows = queryClient.getQueryData<Array<{ name: string }>>(
			householdTableKey("supermarkets", hh),
		);
		expect(rows?.[0]?.name).toBe("Ya tocado localmente");
	});

	it("una fila con forma inesperada (frontera Realtime, D-023) se ignora en vez de escribir a medias", () => {
		const queryClient = new QueryClient();
		applyRealtimePayload(queryClient, "supermarkets", hh, supermarketSchema, {
			id,
			name: 12345, // forma inválida a propósito
		});

		expect(
			queryClient.getQueryData(householdTableKey("supermarkets", hh)),
		).toBeUndefined();
	});
});
