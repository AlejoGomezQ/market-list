import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWakeLock } from "@/lib/use-wake-lock";

/** Sentinel falso mínimo: solo lo que el hook usa (`release`, `addEventListener`). */
function createFakeSentinel() {
	const listeners = new Map<string, Set<() => void>>();
	return {
		release: vi.fn(async () => {
			for (const fn of listeners.get("release") ?? []) fn();
		}),
		addEventListener: vi.fn((type: string, fn: () => void) => {
			const set = listeners.get(type) ?? new Set();
			set.add(fn);
			listeners.set(type, set);
		}),
	};
}

describe("useWakeLock", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		// @ts-expect-error -- limpia el mock entre pruebas, jsdom no trae wakeLock de fábrica.
		delete navigator.wakeLock;
	});

	it("sin soporte del navegador, no hace nada (no lanza)", () => {
		expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
	});

	it("con soporte y `active`, pide el lock de pantalla", async () => {
		const sentinel = createFakeSentinel();
		const request = vi.fn().mockResolvedValue(sentinel);
		Object.defineProperty(navigator, "wakeLock", {
			value: { request },
			configurable: true,
		});

		renderHook(() => useWakeLock(true));
		await vi.waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
	});

	it("al desmontar, libera el lock adquirido", async () => {
		const sentinel = createFakeSentinel();
		const request = vi.fn().mockResolvedValue(sentinel);
		Object.defineProperty(navigator, "wakeLock", {
			value: { request },
			configurable: true,
		});

		const { unmount } = renderHook(() => useWakeLock(true));
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		unmount();
		expect(sentinel.release).toHaveBeenCalledTimes(1);
	});

	it("`active` en false no pide el lock", () => {
		const request = vi.fn();
		Object.defineProperty(navigator, "wakeLock", {
			value: { request },
			configurable: true,
		});

		renderHook(() => useWakeLock(false));
		expect(request).not.toHaveBeenCalled();
	});

	it("al recuperar visibilidad tras liberarse solo, vuelve a pedirlo (limitación conocida de la API)", async () => {
		const firstSentinel = createFakeSentinel();
		const secondSentinel = createFakeSentinel();
		const request = vi
			.fn()
			.mockResolvedValueOnce(firstSentinel)
			.mockResolvedValueOnce(secondSentinel);
		Object.defineProperty(navigator, "wakeLock", {
			value: { request },
			configurable: true,
		});

		renderHook(() => useWakeLock(true));
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

		// El navegador libera el lock solo al perder visibilidad (evento `release` real).
		await firstSentinel.release();

		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			configurable: true,
		});
		document.dispatchEvent(new Event("visibilitychange"));

		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
	});
});
