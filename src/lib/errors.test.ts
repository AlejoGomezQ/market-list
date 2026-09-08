import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, toUserMessage } from "@/lib/errors";
import { SyncConfigError, SyncError } from "@/lib/sync/errors";

describe("toUserMessage", () => {
	it("pasa tal cual el mensaje de un AppError (ya escrito para el usuario)", () => {
		expect(
			toUserMessage(new AppError("Ese código no corresponde a ningún hogar.")),
		).toBe("Ese código no corresponde a ningún hogar.");
	});

	it("un SyncConfigError avisa de que falta configuración", () => {
		expect(toUserMessage(new SyncConfigError("boom"))).toMatch(
			/no está conectada/i,
		);
	});

	it("un SyncError 401 pide reabrir la app", () => {
		const err = new SyncError({ message: "jwt expired" }, 401);
		expect(toUserMessage(err)).toMatch(/sesión caducó/i);
	});

	it("un SyncError 5xx dice que se reintenta solo", () => {
		const err = new SyncError({ message: "upstream" }, 503);
		expect(toUserMessage(err)).toMatch(/se reintenta/i);
	});

	it("un SyncError 4xx dice que el cambio queda guardado para revisar", () => {
		const err = new SyncError({ message: "constraint" }, 409);
		expect(toUserMessage(err)).toMatch(/rechazó un cambio/i);
	});

	it("un ZodError habla de formato inesperado, no del detalle", () => {
		const err = z.string().safeParse(123).error;
		expect(toUserMessage(err)).toMatch(/formato inesperado/i);
	});

	it("un error de almacenamiento (DOMException) pide reabrir la app", () => {
		const err = new DOMException("store missing", "NotFoundError");
		expect(toUserMessage(err)).toMatch(
			/no se pudo guardar en este dispositivo/i,
		);
	});

	it("un TypeError de red menciona la conexión", () => {
		expect(toUserMessage(new TypeError("Failed to fetch"))).toMatch(
			/sin conexión/i,
		);
	});

	it("cualquier otra cosa cae al mensaje genérico, nunca al .message crudo", () => {
		expect(
			toUserMessage(
				new Error("TypeError: cannot read properties of undefined"),
			),
		).toMatch(/algo no funcionó/i);
		expect(toUserMessage("una cadena suelta")).toMatch(/algo no funcionó/i);
	});
});
