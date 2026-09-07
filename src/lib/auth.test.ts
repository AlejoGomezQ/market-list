import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { isAuthNetworkError } from "./auth";

/**
 * La distinción real vive en `@supabase/auth-js` (ver comentario de `isAuthNetworkError` en
 * `auth.ts`); esta prueba solo fija que este módulo la usa correctamente para las dos formas de
 * error que puede devolver `signInAnonymously()`, sin necesidad de una integración real con
 * Supabase.
 */
describe("isAuthNetworkError", () => {
	it("reconoce un fallo de red durante la petición (sin red)", () => {
		const networkError = new AuthRetryableFetchError("fetch failed", 0);
		expect(isAuthNetworkError(networkError)).toBe(true);
	});

	it("no confunde un JWT/credencial rechazada de verdad con un fallo de red", () => {
		const rejected = new AuthApiError("Invalid JWT", 401, "invalid_jwt");
		expect(isAuthNetworkError(rejected)).toBe(false);
	});

	it("no confunde un error cualquiera con un fallo de red", () => {
		expect(isAuthNetworkError(new Error("algo distinto"))).toBe(false);
		expect(isAuthNetworkError(null)).toBe(false);
	});
});

describe("ensureAnonymousSession", () => {
	it("no lanza cuando signInAnonymously falla por red -- se reintenta en el próximo arranque", async () => {
		vi.resetModules();
		vi.doMock("@/lib/supabase", () => ({
			supabase: {
				auth: {
					getSession: () => Promise.resolve({ data: { session: null } }),
					signInAnonymously: () =>
						Promise.resolve({
							data: { session: null, user: null },
							error: new AuthRetryableFetchError("fetch failed", 0),
						}),
				},
			},
			supabaseConfigError: null,
		}));
		const { ensureAnonymousSession } = await import("./auth");
		await expect(ensureAnonymousSession()).resolves.toBeUndefined();
		vi.doUnmock("@/lib/supabase");
	});

	it("propaga un fallo real (no de red) de signInAnonymously", async () => {
		vi.resetModules();
		vi.doMock("@/lib/supabase", () => ({
			supabase: {
				auth: {
					getSession: () => Promise.resolve({ data: { session: null } }),
					signInAnonymously: () =>
						Promise.resolve({
							data: { session: null, user: null },
							error: new AuthApiError(
								"Anonymous sign-ins are disabled",
								422,
								"signup_disabled",
							),
						}),
				},
			},
			supabaseConfigError: null,
		}));
		const { ensureAnonymousSession } = await import("./auth");
		await expect(ensureAnonymousSession()).rejects.toThrow(/disabled/);
		vi.doUnmock("@/lib/supabase");
	});

	it("no llama a signInAnonymously si ya hay sesión guardada", async () => {
		vi.resetModules();
		const signInAnonymously = vi.fn();
		vi.doMock("@/lib/supabase", () => ({
			supabase: {
				auth: {
					getSession: () =>
						Promise.resolve({ data: { session: { access_token: "x" } } }),
					signInAnonymously,
				},
			},
			supabaseConfigError: null,
		}));
		const { ensureAnonymousSession } = await import("./auth");
		await ensureAnonymousSession();
		expect(signInAnonymously).not.toHaveBeenCalled();
		vi.doUnmock("@/lib/supabase");
	});
});
