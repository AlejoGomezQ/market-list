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

	it("el rate limit de join_household (P0001) dice esperar antes de reintentar", () => {
		const err = {
			message: "join_household: demasiados intentos, espera unos minutos",
			code: "P0001",
			details: "",
			hint: "",
		};
		expect(toUserMessage(err)).toMatch(/demasiados intentos/i);
	});

	it("otro raise exception propio (P0001) da un mensaje útil sin el texto crudo", () => {
		const err = {
			message: "create_household: el nombre del hogar no puede estar vacío",
			code: "P0001",
		};
		const msg = toUserMessage(err);
		expect(msg).not.toMatch(/create_household/);
		expect(msg).toMatch(/inténtalo de nuevo/i);
	});

	it("un raise exception de 'no pertenece a ningún hogar' pide volver a entrar con el código", () => {
		const err = {
			message:
				"regenerate_household_code: el usuario no pertenece a ningún hogar",
			code: "P0001",
		};
		const msg = toUserMessage(err);
		expect(msg).not.toMatch(/regenerate_household_code/);
		expect(msg).toMatch(/vuelve a entrar con el código/i);
	});

	it("un raise exception de 'se requiere sesión autenticada' pide reabrir la app", () => {
		const err = {
			message: "leave_household: se requiere sesión autenticada",
			code: "P0001",
		};
		expect(toUserMessage(err)).toMatch(/sesión no está lista/i);
	});

	it("PGRST301 (JWT caducado) dice que la sesión caducó", () => {
		expect(toUserMessage({ message: "JWT expired", code: "PGRST301" })).toMatch(
			/sesión caducó/i,
		);
	});

	it("42501 (RLS/permiso) dice que no tienes permiso", () => {
		expect(
			toUserMessage({
				message: "permission denied for table x",
				code: "42501",
			}),
		).toMatch(/no tienes permiso/i);
	});

	it("23505 (unicidad) dice que ya existe, sin el nombre de la restricción", () => {
		const msg = toUserMessage({
			message: 'duplicate key value violates unique constraint "products_pkey"',
			code: "23505",
		});
		expect(msg).not.toMatch(/constraint/);
		expect(msg).toMatch(/ya existe/i);
	});

	it("PGRST116 (0 filas) dice que no se encontró", () => {
		expect(toUserMessage({ message: "0 rows", code: "PGRST116" })).toMatch(
			/no se encontró/i,
		);
	});

	it("un código de PostgREST no mapeado cae al genérico, sin el .message crudo", () => {
		expect(
			toUserMessage({
				message: "something raw and internal",
				code: "PGRST200",
			}),
		).toMatch(/algo no funcionó/i);
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
