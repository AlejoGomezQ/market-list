import { beforeEach, describe, expect, it, vi } from "vitest";

const idbStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
	createStore: (db: string, store: string) => `${db}:${store}`,
	get: async (key: string) => idbStore.get(key),
	set: async (key: string, value: unknown) => {
		idbStore.set(key, value);
	},
	del: async (key: string) => {
		idbStore.delete(key);
	},
	clear: async () => {
		idbStore.clear();
	},
}));

const { get: idbGet, set: idbSet } = await import("idb-keyval");
const {
	clearHouseholdSyncState,
	clearPersistedSyncState,
	createSyncQueryClient,
	persistOptions,
	queuePersistOptions,
} = await import("./query-client");
const { SYNC_MUTATION_KEY, syncPatches } = await import("./sync/mutation");

beforeEach(() => {
	idbStore.clear();
});

describe("createSyncQueryClient", () => {
	it("registers the sync mutation defaults synchronously, before returning the client -- CLAUDE.md regla #4 (no negociable)", () => {
		// La prueba real es de orden, no de valor: `createSyncQueryClient` es una única función
		// síncrona, así que no existe ningún punto entre "cliente creado" y "defaults registrados"
		// donde algo externo (como el efecto de PersistQueryClientProvider que hidrata desde
		// IndexedDB) pueda colarse. Si `setMutationDefaults` se moviera después de un `await` o a
		// un efecto separado, esta aserción seguiría pasando pero ya no probaría la garantía; por
		// eso se comprueba inmediatamente tras la llamada, sin ningún `await` de por medio.
		const client = createSyncQueryClient();
		const defaults = client.getMutationDefaults(SYNC_MUTATION_KEY);

		expect(defaults?.mutationFn).toBe(syncPatches);
		expect(defaults?.scope).toEqual({ id: "sync" });
	});

	it("sets gcTime: Infinity as the query default (CLAUDE.md, cuatro consultas persistidas)", () => {
		const client = createSyncQueryClient();
		expect(client.getDefaultOptions().queries?.gcTime).toBe(
			Number.POSITIVE_INFINITY,
		);
	});

	it("a mutation created from a rehydrated key resolves its mutationFn from the registered defaults", () => {
		// Simula lo que hace TanStack Query al reanudar una mutación pausada tras hidratar: busca
		// mutationFn por mutationKey en los defaults del cliente. Si `setMutationDefaults` no se
		// hubiese llamado antes, esto sería `undefined` y el parche se perdería en silencio.
		const client = createSyncQueryClient();
		const mutation = client.getMutationCache().build(client, {
			mutationKey: SYNC_MUTATION_KEY,
			...client.getMutationDefaults(SYNC_MUTATION_KEY),
		});
		expect(mutation.options.mutationFn).toBe(syncPatches);
	});

	it("registra retry/retryDelay junto al mutationFn (§5.1/§5.2, clasificación y backoff)", () => {
		const client = createSyncQueryClient();
		const defaults = client.getMutationDefaults(SYNC_MUTATION_KEY);
		expect(typeof defaults?.retry).toBe("function");
		expect(typeof defaults?.retryDelay).toBe("function");
	});
});

describe("D-030 -- la caché es desechable, la cola de salida no: dos persistidores separados", () => {
	it("son dos Persister distintos, cada uno en su propia base de datos de IndexedDB", () => {
		expect(persistOptions.persister).not.toBe(queuePersistOptions.persister);
	});

	it("clearPersistedSyncState nunca rechaza aunque un almacén falle (salir del hogar)", async () => {
		// `clearPersistedSyncState` absorbe cualquier fallo de `clear` (allSettled) y resuelve igual,
		// para que salir del hogar no enseñe un error crudo de IndexedDB al usuario.
		await expect(clearPersistedSyncState()).resolves.toBeUndefined();
	});

	it("el persistidor de la caché nunca guarda mutaciones, pase lo que pase el default de la librería", () => {
		expect(
			persistOptions.dehydrateOptions?.shouldDehydrateMutation?.(
				// biome-ignore lint/suspicious/noExplicitAny: solo hace falta el predicado, no una Mutation real.
				{ state: { isPaused: true } } as any,
			),
		).toBe(false);
	});

	it("el persistidor de la cola nunca guarda consultas de tabla", () => {
		const state = { status: "success" };
		// biome-ignore lint/suspicious/noExplicitAny: solo hace falta el predicado, no una Query real.
		const fakeQuery = { queryKey: ["supermarkets", "hh-1"], state } as any;
		expect(
			queuePersistOptions.dehydrateOptions?.shouldDehydrateQuery?.(fakeQuery),
		).toBe(false);
	});

	it("el persistidor de la cola sí guarda una mutación pausada (el comportamiento por defecto de la librería)", () => {
		expect(
			queuePersistOptions.dehydrateOptions?.shouldDehydrateMutation?.(
				// biome-ignore lint/suspicious/noExplicitAny: solo hace falta el predicado, no una Mutation real.
				{ state: { isPaused: true } } as any,
			),
		).toBe(true);
	});
});

describe("clearHouseholdSyncState (D-047 -- salir de un hogar cuando quedan otros)", () => {
	const ENTITIES = [
		"supermarkets",
		"categories",
		"products",
		"list_items",
	] as const;
	const LEFT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	const KEPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

	it("borra las 4 consultas y los 4 cursores del hogar indicado, sin tocar los de otro", async () => {
		const client = createSyncQueryClient();
		for (const entity of ENTITIES) {
			client.setQueryData([entity, LEFT], [{ id: "l" }]);
			client.setQueryData([entity, KEPT], [{ id: "k" }]);
			await idbSet(`sync:cursor:${LEFT}:${entity}`, "2026-01-01T00:00:00.000Z");
			await idbSet(`sync:cursor:${KEPT}:${entity}`, "2026-01-01T00:00:00.000Z");
		}

		await clearHouseholdSyncState(LEFT, client);

		for (const entity of ENTITIES) {
			expect(client.getQueryData([entity, LEFT])).toBeUndefined();
			expect(client.getQueryData([entity, KEPT])).toEqual([{ id: "k" }]);
			expect(await idbGet(`sync:cursor:${LEFT}:${entity}`)).toBeUndefined();
			expect(await idbGet(`sync:cursor:${KEPT}:${entity}`)).toBe(
				"2026-01-01T00:00:00.000Z",
			);
		}
	});
});
