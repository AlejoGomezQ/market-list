import { describe, expect, it } from "vitest";
import {
	classifySyncError,
	computeBackoffDelayMs,
	SyncConfigError,
	SyncError,
} from "./errors";

describe("classifySyncError (estrategia_sincronizacion §5.1)", () => {
	it("clasifica 401 como de sesión", () => {
		expect(
			classifySyncError(new SyncError({ message: "jwt expired" }, 401)),
		).toBe("session");
	});

	it("clasifica status 0 (fetch que ni llegó a responder) como transitorio", () => {
		expect(
			classifySyncError(new SyncError({ message: "Failed to fetch" }, 0)),
		).toBe("transient");
	});

	it("clasifica 5xx como transitorio (Postgres no disponible)", () => {
		expect(
			classifySyncError(new SyncError({ message: "gateway timeout" }, 503)),
		).toBe("transient");
	});

	it("clasifica 400 como permanente (validación, raise exception de sync_push)", () => {
		expect(
			classifySyncError(
				new SyncError({ message: "bad request", code: "P0001" }, 400),
			),
		).toBe("permanent");
	});

	it("clasifica 403 como permanente (RLS deniega)", () => {
		expect(
			classifySyncError(
				new SyncError({ message: "forbidden", code: "42501" }, 403),
			),
		).toBe("permanent");
	});

	it("clasifica 409 como permanente (violación de restricción única o de clave foránea)", () => {
		expect(
			classifySyncError(
				new SyncError({ message: "conflict", code: "23503" }, 409),
			),
		).toBe("permanent");
	});

	it("clasifica un SyncConfigError (Supabase no configurado) como permanente", () => {
		expect(classifySyncError(new SyncConfigError("sin configurar"))).toBe(
			"permanent",
		);
	});

	it("un error desconocido (no SyncError/SyncConfigError) se trata como transitorio -- nunca se descarta un parche por una excepción que no se sabe clasificar", () => {
		expect(classifySyncError(new TypeError("boom"))).toBe("transient");
	});
});

describe("computeBackoffDelayMs (§5.2: exponencial desde 1s, tope 60s, jitter ±30%)", () => {
	it("sin jitter (random=0.5 -> factor 1), dobla en cada intento hasta el tope", () => {
		const noJitter = () => 0.5;
		expect(computeBackoffDelayMs(0, noJitter)).toBe(1000);
		expect(computeBackoffDelayMs(1, noJitter)).toBe(2000);
		expect(computeBackoffDelayMs(2, noJitter)).toBe(4000);
		expect(computeBackoffDelayMs(3, noJitter)).toBe(8000);
		expect(computeBackoffDelayMs(6, noJitter)).toBe(60_000); // 2^6*1000=64000 > tope
		expect(computeBackoffDelayMs(20, noJitter)).toBe(60_000); // se queda en el tope
	});

	it("el jitter de ±30% se aplica sobre el valor ya topado, nunca lo destopa hacia arriba sin límite", () => {
		const maxJitter = () => 1; // random()=1 -> factor 1.3 (el jitter máximo hacia arriba)
		expect(computeBackoffDelayMs(6, maxJitter)).toBe(Math.round(60_000 * 1.3));
	});

	it("el jitter mínimo (random=0) da el factor 0.7", () => {
		const minJitter = () => 0;
		expect(computeBackoffDelayMs(0, minJitter)).toBe(Math.round(1000 * 0.7));
	});

	it("es determinista: el mismo failureCount y el mismo random() dan siempre el mismo resultado", () => {
		const fixed = () => 0.42;
		expect(computeBackoffDelayMs(3, fixed)).toBe(
			computeBackoffDelayMs(3, fixed),
		);
	});
});
