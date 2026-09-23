import { beforeEach, describe, expect, it, vi } from "vitest";

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

const {
	addToQuarantine,
	getQuarantineSnapshot,
	loadQuarantine,
	removeFromQuarantine,
	subscribeQuarantine,
} = await import("./quarantine");

const patch = {
	entity: "supermarkets" as const,
	id: "sm-1",
	ts: "2026-09-06T10:00:00.000Z",
	fields: { name: "Supermu" },
};

beforeEach(async () => {
	idbStore.clear();
	// El snapshot en memoria del módulo no se resetea solo entre tests (mismo motivo que en
	// producción: no se borra nada sin más) -- `loadQuarantine` lo repone desde el almacén, que
	// acabamos de vaciar.
	await loadQuarantine();
});

describe("quarantine (estrategia_sincronizacion §5.3, §9: nunca se borra solo y en silencio)", () => {
	it("addToQuarantine persiste en el almacén de la cola y actualiza el snapshot en memoria", async () => {
		await addToQuarantine({
			patch,
			reason: "violación de restricción",
			quarantinedAt: "2026-09-06T10:01:00.000Z",
		});

		expect(getQuarantineSnapshot()).toHaveLength(1);
		expect(idbStore.get("quarantine")).toHaveLength(1);
	});

	it("notifica a los suscriptores en cada alta (para el indicador de estado, use-sync-status.ts)", async () => {
		const listener = vi.fn();
		const unsubscribe = subscribeQuarantine(listener);

		await addToQuarantine({
			patch,
			reason: "roto",
			quarantinedAt: "2026-09-06T10:01:00.000Z",
		});

		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();

		await addToQuarantine({
			patch,
			reason: "roto otra vez",
			quarantinedAt: "2026-09-06T10:02:00.000Z",
		});
		expect(listener).toHaveBeenCalledTimes(1); // ya no está suscrito.
	});

	it("un segundo addToQuarantine para el mismo patch.id reemplaza la entrada, no la duplica", async () => {
		await addToQuarantine({
			patch,
			reason: "primer intento",
			quarantinedAt: "2026-09-06T10:01:00.000Z",
		});
		await addToQuarantine({
			patch,
			reason: "reintento tras un transitorio a medio bisectar",
			quarantinedAt: "2026-09-06T10:02:00.000Z",
		});

		const snapshot = getQuarantineSnapshot();
		expect(snapshot).toHaveLength(1);
		expect(snapshot[0]?.reason).toBe(
			"reintento tras un transitorio a medio bisectar",
		);
	});

	it("loadQuarantine repone el snapshot en memoria desde lo persistido (arranque de la app)", async () => {
		idbStore.set("quarantine", [
			{
				patch,
				reason: "de una sesión anterior",
				quarantinedAt: "2026-09-06T09:00:00.000Z",
			},
		]);

		const loaded = await loadQuarantine();

		expect(loaded).toHaveLength(1);
		expect(getQuarantineSnapshot()).toHaveLength(1);
	});

	it("removeFromQuarantine quita solo la entrada pedida, persiste y notifica (reintentar/descartar)", async () => {
		const other = { ...patch, id: "sm-2" };
		await addToQuarantine({
			patch,
			reason: "roto",
			quarantinedAt: "2026-09-06T10:01:00.000Z",
		});
		await addToQuarantine({
			patch: other,
			reason: "también roto",
			quarantinedAt: "2026-09-06T10:02:00.000Z",
		});

		const listener = vi.fn();
		const unsubscribe = subscribeQuarantine(listener);

		await removeFromQuarantine("sm-1");

		expect(listener).toHaveBeenCalledTimes(1);
		expect(getQuarantineSnapshot().map((e) => e.patch.id)).toEqual(["sm-2"]);
		expect(
			(idbStore.get("quarantine") as { patch: { id: string } }[]).map(
				(e) => e.patch.id,
			),
		).toEqual(["sm-2"]);
		unsubscribe();
	});

	it("removeFromQuarantine con un id que no está en cuarentena no hace nada raro", async () => {
		await addToQuarantine({
			patch,
			reason: "roto",
			quarantinedAt: "2026-09-06T10:01:00.000Z",
		});

		await removeFromQuarantine("no-existe");

		expect(getQuarantineSnapshot()).toHaveLength(1);
	});
});
