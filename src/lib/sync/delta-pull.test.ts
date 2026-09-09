import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { householdTableKey } from "@/lib/queries/household-tables";

const idbStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
	createStore: () => "mock-store",
	get: async (key: string) => idbStore.get(key),
	set: async (key: string, value: unknown) => {
		idbStore.set(key, value);
	},
	del: async (key: string) => {
		idbStore.delete(key);
	},
}));

interface RecordedCall {
	table: string;
	gtArgs?: [string, string];
}

const calls = vi.hoisted(() => [] as RecordedCall[]);
const queryResults = vi.hoisted(
	() => new Map<string, { data: unknown[]; error: unknown }>(),
);

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: string) => {
			const record: RecordedCall = { table };
			calls.push(record);
			const builder = {
				select: () => builder,
				eq: () => builder,
				order: () => builder,
				gt: (...args: [string, string]) => {
					record.gtArgs = args;
					return builder;
				},
				// biome-ignore lint/suspicious/noThenProperty: imita el builder thenable de postgrest-js a propósito -- `await request` es justo lo que usa `delta-pull.ts`.
				then: (resolve: (result: { data: unknown; error: unknown }) => void) =>
					resolve(queryResults.get(table) ?? { data: [], error: null }),
			};
			return builder;
		},
	},
	supabaseConfigError: null,
}));

const { deltaPull } = await import("./delta-pull");

const hh = "11111111-1111-4111-8111-111111111111";

function supermarketRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "22222222-2222-4222-8222-222222222222",
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

function setEmptyResultsForOtherTables() {
	queryResults.set("categories", { data: [], error: null });
	queryResults.set("products", { data: [], error: null });
	queryResults.set("list_items", { data: [], error: null });
}

beforeEach(() => {
	idbStore.clear();
	queryResults.clear();
	calls.length = 0;
	setEmptyResultsForOtherTables();
});

describe("deltaPull -- cursor por tabla (estrategia_sincronizacion §6)", () => {
	it("la primera vez, sin cursor guardado, no filtra por updated_at (equivale al primer arranque, §3.1)", async () => {
		const queryClient = new QueryClient();
		queryResults.set("supermarkets", { data: [supermarketRow()], error: null });

		await deltaPull(queryClient, hh);

		const supermarketsCall = calls.find((c) => c.table === "supermarkets");
		expect(supermarketsCall?.gtArgs).toBeUndefined();
	});

	it("aplica las filas traídas a la consulta persistida con el reductor (upsert por id, no reemplazo ciego)", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(householdTableKey("supermarkets", hh), [
			supermarketRow({
				id: "33333333-3333-4333-8333-333333333333",
				name: "Ya estaba",
				updated_at: "2026-09-06T08:00:00.000Z",
				field_updated_at: { name: "2026-09-06T08:00:00.000Z" },
			}),
		]);
		queryResults.set("supermarkets", { data: [supermarketRow()], error: null });

		await deltaPull(queryClient, hh);

		const rows = queryClient.getQueryData<Array<{ id: string }>>(
			householdTableKey("supermarkets", hh),
		);
		expect(rows?.map((r) => r.id).sort()).toEqual([
			"22222222-2222-4222-8222-222222222222",
			"33333333-3333-4333-8333-333333333333",
		]);
	});

	it("guarda el cursor con el margen de 5s de §6.3 y lo usa como filtro en la siguiente vuelta", async () => {
		const queryClient = new QueryClient();
		queryResults.set("supermarkets", { data: [supermarketRow()], error: null });

		await deltaPull(queryClient, hh);

		const storedCursor = idbStore.get(
			`sync:cursor:${hh}:supermarkets`,
		) as string;
		expect(storedCursor).toBeDefined();
		expect(new Date(storedCursor).getTime()).toBe(
			new Date("2026-09-06T10:00:00.000Z").getTime() - 5000,
		);

		queryResults.set("supermarkets", { data: [], error: null }); // nada nuevo esta vez.
		await deltaPull(queryClient, hh);

		const secondCall = calls.filter((c) => c.table === "supermarkets").at(-1);
		expect(secondCall?.gtArgs).toEqual(["updated_at", storedCursor]);

		// Sin filas nuevas, el cursor no se mueve -- no hay nada que retrasar 5s de nuevo.
		expect(idbStore.get(`sync:cursor:${hh}:supermarkets`)).toBe(storedCursor);
	});

	it("cada hogar lleva su propio cursor (D-044): el delta pull del hogar B no lee ni pisa el del A", async () => {
		const queryClient = new QueryClient();
		const hhB = "99999999-9999-4999-8999-999999999999";
		queryResults.set("supermarkets", { data: [supermarketRow()], error: null });

		await deltaPull(queryClient, hh);
		const cursorA = idbStore.get(`sync:cursor:${hh}:supermarkets`) as string;
		expect(cursorA).toBeDefined();
		expect(idbStore.get(`sync:cursor:${hhB}:supermarkets`)).toBeUndefined();

		calls.length = 0;
		queryResults.set("supermarkets", { data: [], error: null });
		await deltaPull(queryClient, hhB);

		// Sin cursor propio, el hogar B arranca con un pull completo (no filtra por updated_at)...
		const bCall = calls.find((c) => c.table === "supermarkets");
		expect(bCall?.gtArgs).toBeUndefined();
		// ...y el cursor del hogar A queda intacto.
		expect(idbStore.get(`sync:cursor:${hh}:supermarkets`)).toBe(cursorA);
	});

	it("una fila con forma inesperada (frontera Realtime/red, D-023) no revienta el pull ni mueve el cursor", async () => {
		const queryClient = new QueryClient();
		queryResults.set("supermarkets", {
			data: [{ id: "sm-1", name: 12345 }], // forma inválida a propósito
			error: null,
		});

		await expect(deltaPull(queryClient, hh)).resolves.toBeUndefined();
		expect(idbStore.get(`sync:cursor:${hh}:supermarkets`)).toBeUndefined();
	});
});
