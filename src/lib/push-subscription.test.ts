import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Frontera Zod hacia push_subscriptions (CLAUDE.md, "tres fronteras"): la clave VAPID no necesita
// ser una clave real para estas pruebas, solo un base64url válido -- `urlBase64ToUint8Array` no
// verifica el contenido, solo lo decodifica.
vi.stubEnv(
	"VITE_VAPID_PUBLIC_KEY",
	"BNbxGYNMhEZjkGqPFYb0bJx0tLoOK5w6zH3F1oXk8p9qzX3P4v9y2Q0m1n2o3p4",
);

interface FakeResult {
	error: { message: string } | null;
}

const upsertMock =
	vi.fn<(row: unknown, opts: unknown) => Promise<FakeResult>>();
const eqMock = vi.fn<(col: string, value: string) => Promise<FakeResult>>();
const deleteMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn((_table: string) => ({
	upsert: upsertMock,
	delete: deleteMock,
}));
const getSessionMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: string) => fromMock(table),
		auth: { getSession: () => getSessionMock() },
	},
	supabaseConfigError: null,
}));

const {
	subscribeToPush,
	unsubscribeFromPush,
	reconcilePushSubscription,
	usePushSubscription,
} = await import("./push-subscription");

const USER_ID = "11111111-1111-4111-8111-111111111111";

function fakeSubscription(endpoint = "https://push.example/abc") {
	return {
		endpoint,
		toJSON: () => ({ keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
		unsubscribe: vi.fn(async () => true),
	};
}

/** Instala Notification/serviceWorker/PushManager mínimos para que `pushSupported()` sea true. */
function stubPushApis({
	permission = "default" as NotificationPermission,
	requestPermission = vi.fn(async () => "granted" as NotificationPermission),
	getSubscription = vi.fn(async () => null as unknown),
	subscribe = vi.fn(async () => fakeSubscription()),
} = {}) {
	vi.stubGlobal("Notification", {
		permission,
		requestPermission,
	});
	vi.stubGlobal("PushManager", class {});
	Object.defineProperty(navigator, "serviceWorker", {
		value: {
			ready: Promise.resolve({
				pushManager: { getSubscription, subscribe },
			}),
		},
		configurable: true,
	});
	return { requestPermission, getSubscription, subscribe };
}

beforeEach(() => {
	upsertMock.mockReset().mockResolvedValue({ error: null });
	eqMock.mockReset().mockResolvedValue({ error: null });
	deleteMock.mockClear();
	fromMock.mockClear();
	getSessionMock
		.mockReset()
		.mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
});

afterEach(() => {
	vi.unstubAllGlobals();
	// @ts-expect-error -- jsdom no trae serviceWorker de fábrica; limpiar entre pruebas.
	delete navigator.serviceWorker;
});

describe("subscribeToPush", () => {
	it("sin soporte del navegador, lanza sin tocar Supabase", async () => {
		await expect(subscribeToPush()).rejects.toThrow(/no admite/);
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("pide permiso, suscribe y sube la fila con onConflict: endpoint", async () => {
		const subscription = fakeSubscription();
		stubPushApis({
			requestPermission: vi.fn(async () => "granted"),
			getSubscription: vi.fn(async () => null),
			subscribe: vi.fn(async () => subscription),
		});

		await subscribeToPush();

		expect(fromMock).toHaveBeenCalledWith("push_subscriptions");
		expect(upsertMock).toHaveBeenCalledTimes(1);
		const [row, opts] = upsertMock.mock.calls[0];
		expect(row).toEqual({
			endpoint: subscription.endpoint,
			user_id: USER_ID,
			p256dh: "p256dh-key",
			auth: "auth-secret",
			user_agent: navigator.userAgent,
		});
		expect(opts).toEqual({ onConflict: "endpoint" });
	});

	it("reutiliza una suscripción existente en vez de crear una segunda", async () => {
		const existing = fakeSubscription();
		const subscribeFn = vi.fn(async () => fakeSubscription("otro-endpoint"));
		stubPushApis({
			getSubscription: vi.fn(async () => existing),
			subscribe: subscribeFn,
		});

		await subscribeToPush();

		expect(subscribeFn).not.toHaveBeenCalled();
		expect(upsertMock.mock.calls[0][0]).toMatchObject({
			endpoint: existing.endpoint,
		});
	});

	it("permiso denegado: lanza y no sube nada", async () => {
		stubPushApis({
			requestPermission: vi.fn(async () => "denied"),
		});

		await expect(subscribeToPush()).rejects.toThrow(/[Pp]ermiso/);
		expect(upsertMock).not.toHaveBeenCalled();
	});
});

describe("unsubscribeFromPush", () => {
	it("sin suscripción activa, no borra nada", async () => {
		stubPushApis({ getSubscription: vi.fn(async () => null) });
		await unsubscribeFromPush();
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it("con suscripción activa, la cancela en el navegador y borra la fila por endpoint", async () => {
		const subscription = fakeSubscription();
		stubPushApis({ getSubscription: vi.fn(async () => subscription) });

		await unsubscribeFromPush();

		expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
		expect(fromMock).toHaveBeenCalledWith("push_subscriptions");
		expect(eqMock).toHaveBeenCalledWith("endpoint", subscription.endpoint);
	});
});

describe("reconcilePushSubscription", () => {
	it("sin permiso concedido, no toca Supabase", async () => {
		stubPushApis({ permission: "default" });
		await reconcilePushSubscription();
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it("con permiso y suscripción viva, resube la fila (cubre un endpoint que cambió)", async () => {
		const subscription = fakeSubscription();
		stubPushApis({
			permission: "granted",
			getSubscription: vi.fn(async () => subscription),
		});

		await reconcilePushSubscription();

		expect(upsertMock).toHaveBeenCalledTimes(1);
		expect(upsertMock.mock.calls[0][0]).toMatchObject({
			endpoint: subscription.endpoint,
		});
	});

	it("con permiso pero sin suscripción viva, no sube nada", async () => {
		stubPushApis({
			permission: "granted",
			getSubscription: vi.fn(async () => null),
		});
		await reconcilePushSubscription();
		expect(upsertMock).not.toHaveBeenCalled();
	});
});

describe("usePushSubscription", () => {
	it("sin soporte del navegador, expone status 'unsupported'", async () => {
		const { result } = renderHook(() => usePushSubscription());
		await waitFor(() => expect(result.current.status).toBe("unsupported"));
	});

	it("con permiso denegado, expone status 'denied'", async () => {
		stubPushApis({ permission: "denied" });
		const { result } = renderHook(() => usePushSubscription());
		await waitFor(() => expect(result.current.status).toBe("denied"));
	});

	it("con permiso concedido y suscripción activa, expone status 'on'", async () => {
		stubPushApis({
			permission: "granted",
			getSubscription: vi.fn(async () => fakeSubscription()),
		});
		const { result } = renderHook(() => usePushSubscription());
		await waitFor(() => expect(result.current.status).toBe("on"));
	});

	it("enable() activa la suscripción y actualiza el status a 'on'", async () => {
		stubPushApis({
			permission: "default",
			requestPermission: vi.fn(async () => "granted"),
			getSubscription: vi.fn(async () => null),
			subscribe: vi.fn(async () => fakeSubscription()),
		});
		const { result } = renderHook(() => usePushSubscription());
		await waitFor(() => expect(result.current.status).toBe("off"));

		await result.current.enable();

		await waitFor(() => expect(result.current.status).toBe("on"));
		expect(upsertMock).toHaveBeenCalledTimes(1);
	});

	it("disable() desactiva la suscripción y actualiza el status a 'off'", async () => {
		const subscription = fakeSubscription();
		stubPushApis({
			permission: "granted",
			getSubscription: vi.fn(async () => subscription),
		});
		const { result } = renderHook(() => usePushSubscription());
		await waitFor(() => expect(result.current.status).toBe("on"));

		await result.current.disable();

		await waitFor(() => expect(result.current.status).toBe("off"));
		expect(eqMock).toHaveBeenCalledWith("endpoint", subscription.endpoint);
	});
});
