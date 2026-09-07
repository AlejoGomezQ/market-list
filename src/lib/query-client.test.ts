import { describe, expect, it } from "vitest";
import { createSyncQueryClient } from "./query-client";
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
});
