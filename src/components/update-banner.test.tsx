import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * `virtual:pwa-register/react` es un módulo virtual de vite-plugin-pwa que no existe bajo Vitest.
 * El mock guarda las opciones que le pasa `UpdateBanner` para que el test dispare `onRegisteredSW`
 * con un registro falso y compruebe el chequeo periódico de actualización.
 */
let registeredOptions:
	| {
			onRegisteredSW?: (
				url: string,
				registration: ServiceWorkerRegistration | undefined,
			) => void;
	  }
	| undefined;

vi.mock("virtual:pwa-register/react", () => ({
	useRegisterSW: (options: typeof registeredOptions) => {
		registeredOptions = options;
		return {
			needRefresh: [false],
			offlineReady: [false],
			updateServiceWorker: vi.fn(),
		};
	},
}));

const { UpdateBanner } = await import("./update-banner");

const update = vi.fn(() => Promise.resolve());
const fakeRegistration = { update } as unknown as ServiceWorkerRegistration;

function registerSW() {
	act(() => {
		registeredOptions?.onRegisteredSW?.("/sw.js", fakeRegistration);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	update.mockClear();
	registeredOptions = undefined;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it("pide update() cada hora una vez registrado el service worker", () => {
	render(<UpdateBanner />);
	registerSW();

	expect(update).not.toHaveBeenCalled();
	act(() => {
		vi.advanceTimersByTime(60 * 60 * 1000);
	});
	expect(update).toHaveBeenCalledTimes(1);
	act(() => {
		vi.advanceTimersByTime(60 * 60 * 1000);
	});
	expect(update).toHaveBeenCalledTimes(2);
});

it("pide update() al volver la app a primer plano", () => {
	render(<UpdateBanner />);
	registerSW();

	Object.defineProperty(document, "visibilityState", {
		value: "visible",
		configurable: true,
	});
	act(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});

	expect(update).toHaveBeenCalledTimes(1);
});

it("deja de chequear al desmontarse", () => {
	const { unmount } = render(<UpdateBanner />);
	registerSW();

	unmount();
	act(() => {
		vi.advanceTimersByTime(60 * 60 * 1000);
		document.dispatchEvent(new Event("visibilitychange"));
	});

	expect(update).not.toHaveBeenCalled();
});
