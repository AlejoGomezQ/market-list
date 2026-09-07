import {
	dehydrate,
	hydrate,
	onlineManager,
	QueryClient,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncPatch } from "@/schemas/patch";

/**
 * El caso crítico de la Fase 6 (plan_implementacion, "Listo cuando (a)"): cerrar la app con la
 * cola llena, reabrir, y que suba. El riesgo documentado es que `setMutationDefaults` se pierda en
 * silencio tras rehidratar -- una mutación rehidratada busca su `mutationFn` por `mutationKey` en
 * los defaults del cliente NUEVO (no del que la creó), y si esos defaults no están, la mutación
 * queda con `mutationFn: undefined` y nunca vuelve a intentar nada, sin lanzar ningún error.
 *
 * Se simula "cerrar y reabrir" sin tocar IndexedDB de verdad (jsdom no la implementa, y no hace
 * falta: lo único que `PersistQueryClientProvider`/`startOutboxQueue` añaden encima de esto es la
 * serialización a un `storage` real, que ya prueba `query-client.test.ts` con Zod y JSON). Lo que
 * importa aquí es exactamente el ciclo `dehydrate` -> "app cerrada" -> `QueryClient` nuevo ->
 * `hydrate`, que es lo que `@tanstack/query-persist-client-core` hace por dentro
 * (`persistQueryClientRestore`/`persistQueryClientSave`, ver `sync/queue.ts`).
 */

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
	supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
	supabaseConfigError: null,
}));
vi.mock("@/lib/auth", () => ({
	ensureAnonymousSession: async () => {},
}));

const { createSyncQueryClient } = await import("@/lib/query-client");
const { SYNC_MUTATION_KEY } = await import("./mutation");

const patch: SyncPatch = {
	entity: "supermarkets",
	id: "sm-1",
	ts: "2026-09-06T10:00:00.000Z",
	fields: { name: "Supermu" },
};

afterEach(() => {
	onlineManager.setOnline(true);
	rpcMock.mockReset();
});

describe("cerrar la app con la cola llena y reabrir (plan_implementacion Fase 6, criterio (a))", () => {
	it("una mutación pausada, dehidratada y rehidratada en un QueryClient creado con createSyncQueryClient, conserva su mutationFn y sí llega a enviarse", async () => {
		// 1) "Antes de cerrar la app": una mutación queda pausada porque no hay red.
		onlineManager.setOnline(false);
		const beforeClose = createSyncQueryClient();
		const pending = beforeClose.getMutationCache().build(beforeClose, {
			mutationKey: SYNC_MUTATION_KEY,
			...beforeClose.getMutationDefaults(SYNC_MUTATION_KEY),
		});
		void pending.execute([patch]);
		// La mutación se pausa de forma asíncrona (el *retryer* comprueba `onlineManager` antes de
		// intentar); se espera un tick para que `isPaused` quede en `true` antes de "cerrar".
		await vi.waitFor(() => {
			expect(pending.state.isPaused).toBe(true);
		});

		// 2) "Cerrar la app": se dehidrata tal como lo hace `persistQueryClientSave`
		// (`@tanstack/query-persist-client-core`, ver `queuePersistOptions` en `query-client.ts`).
		const dehydrated = dehydrate(beforeClose, {
			shouldDehydrateQuery: () => false,
			shouldDehydrateMutation: (mutation) => mutation.state.isPaused,
		});
		expect(dehydrated.mutations).toHaveLength(1);

		// 3) "Reabrir la app": un QueryClient NUEVO, construido exactamente como lo hace la app de
		// verdad (`createSyncQueryClient`, que registra `setMutationDefaults` de forma síncrona antes
		// de devolver el cliente -- la regla no negociable de CLAUDE.md).
		const afterReopen = createSyncQueryClient();
		hydrate(afterReopen, dehydrated);

		const [rehydrated] = afterReopen.getMutationCache().getAll();
		expect(rehydrated).toBeDefined();
		// Esta es la aserción que de verdad importa: si `setMutationDefaults` se hubiera llamado
		// después de este `hydrate` (o no se hubiera llamado), `mutationFn` sería `undefined` aquí y
		// el resto del test fallaría al intentar reanudar -- no con un error ruidoso, sino con la
		// mutación simplemente no haciendo nada nunca.
		expect(rehydrated?.options.mutationFn).toBeDefined();

		// 4) Vuelve la red: se reanuda la cola, tal como hace `startOutboxQueue` (`sync/queue.ts`) al
		// arrancar. Si `mutationFn` faltara, `resumePausedMutations` no tendría nada que ejecutar y
		// esta llamada al RPC nunca ocurriría.
		rpcMock.mockResolvedValue({ data: [], error: null, status: 200 });
		onlineManager.setOnline(true);
		await afterReopen.resumePausedMutations();

		expect(rpcMock).toHaveBeenCalledTimes(1);
		expect(rpcMock).toHaveBeenCalledWith("sync_push", { p_patches: [patch] });
		expect(rehydrated?.state.status).toBe("success");
	});

	it("documenta el fallo silencioso que este criterio existe para evitar: un QueryClient SIN setMutationDefaults rehidrata la mutación sin mutationFn, y nunca vuelve a intentar nada", async () => {
		onlineManager.setOnline(false);
		const beforeClose = createSyncQueryClient(); // este sí registra los defaults, para poder pausar algo real.
		const pending = beforeClose.getMutationCache().build(beforeClose, {
			mutationKey: SYNC_MUTATION_KEY,
			...beforeClose.getMutationDefaults(SYNC_MUTATION_KEY),
		});
		void pending.execute([patch]);
		await vi.waitFor(() => {
			expect(pending.state.isPaused).toBe(true);
		});
		const dehydrated = dehydrate(beforeClose, {
			shouldDehydrateQuery: () => false,
			shouldDehydrateMutation: (mutation) => mutation.state.isPaused,
		});

		// El "reopen" roto: un QueryClient corriente, sin pasar por createSyncQueryClient.
		const brokenReopen = new QueryClient();
		hydrate(brokenReopen, dehydrated);

		const [rehydrated] = brokenReopen.getMutationCache().getAll();
		expect(rehydrated?.options.mutationFn).toBeUndefined();

		onlineManager.setOnline(true);
		await brokenReopen.resumePausedMutations();

		// Nada se envió, y no hay ningún error que avisarlo -- exactamente "se pierde en silencio".
		expect(rpcMock).not.toHaveBeenCalled();
		expect(rehydrated?.state.status).not.toBe("success");
	});
});
