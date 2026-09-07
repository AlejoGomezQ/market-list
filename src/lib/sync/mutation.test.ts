import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncPatch } from "@/schemas/patch";

interface RpcResult {
	data: unknown;
	error: { message: string; code?: string } | null;
	status: number;
}
type RpcArgs = { p_patches: SyncPatch[] };

const rpcMock = vi.fn<(fn: string, args: RpcArgs) => Promise<RpcResult>>();
vi.mock("@/lib/supabase", () => ({
	supabase: { rpc: (fn: string, args: RpcArgs) => rpcMock(fn, args) },
	supabaseConfigError: null,
}));

const ensureAnonymousSessionMock = vi.fn(async () => {});
vi.mock("@/lib/auth", () => ({
	ensureAnonymousSession: () => ensureAnonymousSessionMock(),
}));

interface QuarantineEntry {
	patch: SyncPatch;
	reason: string;
	quarantinedAt: string;
}

const addToQuarantineMock = vi.fn(async (_entry: QuarantineEntry) => {});
vi.mock("@/lib/sync/quarantine", () => ({
	addToQuarantine: (entry: QuarantineEntry) => addToQuarantineMock(entry),
}));

const { syncPatches, syncRetry, syncRetryDelay } = await import("./mutation");
const { SyncError } = await import("./errors");

const ts = "2026-09-06T10:00:00.000Z";

function patch(id: string, overrides: Partial<SyncPatch> = {}): SyncPatch {
	return {
		entity: "supermarkets",
		id,
		ts,
		fields: { name: "Supermu" },
		...overrides,
	};
}

/** Los ids de los parches puestos en cuarentena, en el orden en que se llamó a `addToQuarantine`. */
function quarantinedIds(): string[] {
	return addToQuarantineMock.mock.calls.map((call) => call[0].patch.id);
}

/** El parche puesto en cuarentena en la llamada `i` (0-indexado). */
function quarantinedPatch(i: number): SyncPatch {
	const call = addToQuarantineMock.mock.calls[i];
	if (!call) throw new Error(`addToQuarantine no se llamó ${i + 1} veces`);
	return call[0].patch;
}

/** Firma que espera `pushBatch`: `{data, error, status}`, igual que `supabase.rpc(...)`. */
function rpcResult(status: number, code?: string): RpcResult {
	if (status >= 200 && status < 300) return { data: [], error: null, status };
	return { data: null, error: { message: `error ${status}`, code }, status };
}

beforeEach(() => {
	rpcMock.mockReset();
	ensureAnonymousSessionMock.mockClear();
	addToQuarantineMock.mockClear();
});

describe("syncPatches -- camino feliz", () => {
	it("envía el lote entero en una sola llamada y no toca la cuarentena", async () => {
		rpcMock.mockResolvedValue(rpcResult(200));
		await syncPatches([patch("a"), patch("b")]);
		expect(rpcMock).toHaveBeenCalledTimes(1);
		expect(addToQuarantineMock).not.toHaveBeenCalled();
	});
});

describe("syncPatches -- transitorio y de sesión (§5.1): nunca se resuelven aquí, se relanzan", () => {
	it("un 5xx se relanza sin pasar por cuarentena", async () => {
		rpcMock.mockResolvedValue(rpcResult(503));
		await expect(syncPatches([patch("a")])).rejects.toBeInstanceOf(SyncError);
		expect(addToQuarantineMock).not.toHaveBeenCalled();
	});

	it("un 401 intenta refrescar la sesión (Fase 2b) antes de relanzar", async () => {
		rpcMock.mockResolvedValue(rpcResult(401));
		await expect(syncPatches([patch("a")])).rejects.toBeInstanceOf(SyncError);
		expect(ensureAnonymousSessionMock).toHaveBeenCalledTimes(1);
		expect(addToQuarantineMock).not.toHaveBeenCalled();
	});
});

describe("syncPatches -- permanente, un solo parche (§5.1, §5.3)", () => {
	it("se pone en cuarentena y la mutación se resuelve (no queda bloqueando la cola)", async () => {
		rpcMock.mockResolvedValue(rpcResult(400, "P0001"));
		await expect(syncPatches([patch("a")])).resolves.toBeUndefined();
		expect(addToQuarantineMock).toHaveBeenCalledTimes(1);
		expect(quarantinedPatch(0).id).toBe("a");
	});
});

describe("syncPatches -- bisección de un lote roto (§4.3 lote atómico + §5.3 cuarentena)", () => {
	it("aísla el parche permanentemente roto y aplica el resto del lote", async () => {
		rpcMock.mockImplementation(
			async (_fn: string, { p_patches }: { p_patches: SyncPatch[] }) => {
				if (p_patches.length > 1) return rpcResult(400, "P0001"); // el lote entero aborta
				if (p_patches[0].id === "bad") return rpcResult(400, "P0001");
				return rpcResult(200);
			},
		);

		await syncPatches([patch("good"), patch("bad")]);

		// 1 intento del lote + 2 de la bisección (uno por parche).
		expect(rpcMock).toHaveBeenCalledTimes(3);
		expect(addToQuarantineMock).toHaveBeenCalledTimes(1);
		expect(quarantinedPatch(0).id).toBe("bad");
	});

	it("un list_item que depende de un producto también roto cae en cuarentena por su cuenta -- sin grafo de dependencias a mano, vía la violación de clave foránea real (§5.3, 'las dependientes se van con ella')", async () => {
		const productPatch = patch("prod-bad", {
			entity: "products",
			fields: { name: "Leche" },
		});
		const listItemPatch = patch("li-1", {
			entity: "list_items",
			fields: { product_id: "prod-bad", quantity: 1, checked: false },
		});

		rpcMock.mockImplementation(
			async (_fn: string, { p_patches }: { p_patches: SyncPatch[] }) => {
				if (p_patches.length > 1) return rpcResult(400, "P0001");
				const [p] = p_patches;
				if (p.entity === "products") return rpcResult(400, "P0001"); // el producto en sí no valida
				if (p.entity === "list_items") return rpcResult(409, "23503"); // FK contra un producto que nunca existió
				return rpcResult(200);
			},
		);

		await syncPatches([productPatch, listItemPatch]);

		expect(addToQuarantineMock).toHaveBeenCalledTimes(2);
		expect(quarantinedIds()).toEqual(["prod-bad", "li-1"]);
	});
});

describe("syncPatches -- FK anulable en products (§5.3: anular en vez de descartar)", () => {
	it("reintenta un products roto por category_id/supermarket_id sin esos campos antes de rendirse", async () => {
		const productPatch = patch("prod-1", {
			entity: "products",
			fields: { name: "Leche", category_id: "missing-cat" },
		});
		rpcMock.mockImplementation(
			async (_fn: string, { p_patches }: { p_patches: SyncPatch[] }) => {
				if (p_patches[0].fields.category_id === "missing-cat") {
					return rpcResult(409, "23503");
				}
				return rpcResult(200);
			},
		);

		await syncPatches([productPatch]);

		expect(addToQuarantineMock).not.toHaveBeenCalled();
		expect(rpcMock).toHaveBeenCalledTimes(2);
		const secondCall = rpcMock.mock.calls[1]?.[1] as { p_patches: SyncPatch[] };
		expect(secondCall.p_patches[0].fields.category_id).toBeNull();
	});

	it("si tampoco funciona sin el FK, pone en cuarentena el parche ORIGINAL, no el recortado", async () => {
		const productPatch = patch("prod-1", {
			entity: "products",
			fields: { name: "Leche", category_id: "missing-cat" },
		});
		rpcMock.mockResolvedValue(rpcResult(409, "23503"));

		await syncPatches([productPatch]);

		expect(addToQuarantineMock).toHaveBeenCalledTimes(1);
		expect(quarantinedPatch(0).fields.category_id).toBe("missing-cat");
	});
});

describe("syncRetry/syncRetryDelay (registrados en setMutationDefaults, query-client.ts)", () => {
	it("nunca reintenta un error permanente", () => {
		expect(syncRetry(0, new SyncError({ message: "bad" }, 400))).toBe(false);
	});

	it("un error de sesión se reintenta exactamente una vez", () => {
		const err = new SyncError({ message: "jwt" }, 401);
		expect(syncRetry(0, err)).toBe(true);
		expect(syncRetry(1, err)).toBe(false);
	});

	it("un error transitorio se reintenta siempre", () => {
		const err = new SyncError({ message: "gateway" }, 503);
		expect(syncRetry(0, err)).toBe(true);
		expect(syncRetry(50, err)).toBe(true);
	});

	it("el retraso para un error de sesión es 0 (la sesión ya se refrescó en el catch de syncPatches)", () => {
		expect(syncRetryDelay(0, new SyncError({ message: "jwt" }, 401))).toBe(0);
	});

	it("el retraso para un error transitorio sigue el backoff con jitter", () => {
		const delay = syncRetryDelay(0, new SyncError({ message: "gateway" }, 503));
		expect(delay).toBeGreaterThanOrEqual(700); // 1000 * 0.7
		expect(delay).toBeLessThanOrEqual(1300); // 1000 * 1.3
	});
});
