import { describe, expect, it } from "vitest";
import {
	clearPersistedSyncState,
	createSyncQueryClient,
	persistOptions,
	queuePersistOptions,
} from "./query-client";
import { SYNC_MUTATION_KEY, syncPatches } from "./sync/mutation";

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

	it("clearPersistedSyncState nunca rechaza aunque un almacén no exista (salir del hogar)", async () => {
		// jsdom no implementa IndexedDB, así que ambos `clear` rechazan aquí: la aserción es que
		// `clearPersistedSyncState` los absorbe (allSettled) y resuelve igual, para que salir del
		// hogar no enseñe un error crudo de IndexedDB al usuario.
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
