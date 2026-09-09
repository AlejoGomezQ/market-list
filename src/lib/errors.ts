import * as Sentry from "@sentry/react";
import { z } from "zod";
import { SyncConfigError, SyncError } from "@/lib/sync/errors";

/**
 * Manejo de errores (backlog_v2 §7). Dos trabajos separados:
 *
 *  - `reportError` / `reportEvent`: mandan el detalle técnico a Sentry (no-op si `VITE_SENTRY_DSN`
 *    no está -- local y tests) y lo dejan en consola. Es lo que ve quien mantiene la app.
 *  - `toUserMessage`: traduce la excepción a una frase para una persona (tono identidad_visual §8),
 *    sin `.message` crudo ni jerga. Es lo que ve quien usa la app.
 */

/**
 * Error cuyo `message` YA está escrito para el usuario (p. ej. "Código inválido."). No es un fallo
 * que haya que investigar: `reportError` lo ignora y `toUserMessage` lo muestra tal cual.
 */
export class AppError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AppError";
	}
}

const GENERIC_MESSAGE =
	"Algo no funcionó. Si sigue pasando, cierra y vuelve a abrir la app.";

/** Envía la excepción a Sentry y la deja en consola. `context` va como `extra` -- datos para
 * depurar, nunca contenido del hogar. Un `AppError` es un mensaje esperado, no se reporta. */
export function reportError(
	error: unknown,
	context?: Record<string, unknown>,
): void {
	if (error instanceof AppError) return;
	console.error(error, context ?? "");
	Sentry.captureException(error, context ? { extra: context } : undefined);
}

/** Como `reportError` pero para un estado conocido que no trae excepción (p. ej. un parche en
 * cuarentena): se registra como mensaje de nivel error con su contexto. */
export function reportEvent(
	message: string,
	context?: Record<string, unknown>,
): void {
	console.error(message, context ?? "");
	Sentry.captureMessage(message, {
		level: "error",
		extra: context,
	});
}

function isStorageError(error: unknown): boolean {
	if (error instanceof DOMException) return true;
	// idb-keyval a veces relanza como Error normal con el `name` de la DOMException original.
	return (
		error instanceof Error &&
		[
			"QuotaExceededError",
			"NotFoundError",
			"InvalidStateError",
			"DataError",
			"VersionError",
		].includes(error.name)
	);
}

function isNetworkError(error: unknown): boolean {
	return (
		error instanceof TypeError &&
		/fetch|network|load failed/i.test(error.message)
	);
}

/**
 * Un error de PostgREST/supabase-js llega como `{ message, code, details, hint }` -- en supabase-js
 * reciente `PostgrestError extends Error`, así que basta comprobar la forma. `code` es el SQLSTATE de
 * Postgres (`23505`, `42501`, …) o un código propio de PostgREST (`PGRST301`, `PGRST116`, …).
 */
function isPostgrestError(
	error: unknown,
): error is { message: string; code: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		"message" in error &&
		typeof (error as { code: unknown }).code === "string" &&
		typeof (error as { message: unknown }).message === "string"
	);
}

/**
 * Un `raise exception` propio de una función SQL de onboarding (`join_household`, `create_household`,
 * `regenerate_household_code`, `leave_household`) o de `sync_push`. El SQLSTATE por defecto de
 * `raise exception` es `P0001`.
 */
export function isPostgresRaise(
	error: unknown,
): error is { message: string; code: string } {
	return isPostgrestError(error) && error.code === "P0001";
}

/**
 * Frase para el usuario. El orden importa: primero las clases que conocemos, y solo al final el
 * genérico -- nunca se deja escapar el `.message` de una excepción cualquiera.
 */
export function toUserMessage(error: unknown): string {
	if (error instanceof AppError) return error.message;
	if (error instanceof SyncConfigError) {
		return "La app no está conectada al servidor. Avisa a quien la configuró.";
	}
	if (error instanceof SyncError) {
		if (error.status === 401) {
			return "Tu sesión caducó. Cierra y vuelve a abrir la app.";
		}
		if (error.status === 0 || error.status >= 500) {
			return "El servidor no responde ahora mismo. Se reintenta solo.";
		}
		return "El servidor rechazó un cambio. Queda guardado para revisarlo.";
	}
	if (error instanceof z.ZodError) {
		return "Llegó una respuesta con un formato inesperado. Inténtalo de nuevo.";
	}
	if (isStorageError(error)) {
		return "No se pudo guardar en este dispositivo. Cierra y vuelve a abrir la app.";
	}
	if (isNetworkError(error)) {
		return "Sin conexión. Se guardó en el dispositivo y se sube cuando vuelva la red.";
	}
	if (isPostgresRaise(error)) {
		// `raise exception` propios, distinguidos por su texto (el texto crudo lleva el nombre de la
		// función SQL y va a Sentry, nunca a pantalla). El orden no importa: los patrones no solapan.
		if (/demasiados intentos/i.test(error.message)) {
			return "Demasiados intentos. Espera un momento antes de volver a probar.";
		}
		if (/no pertenece a ning[uú]n hogar/i.test(error.message)) {
			return "Este dispositivo ya no está en ningún hogar. Vuelve a entrar con el código.";
		}
		if (/se requiere sesi[oó]n autenticada/i.test(error.message)) {
			return "Tu sesión no está lista. Cierra y vuelve a abrir la app.";
		}
		// Otro `raise exception` propio: un poco más útil que el genérico, sin soltar el texto crudo.
		return "No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.";
	}
	if (isPostgrestError(error)) {
		// Códigos estándar de PostgREST/Postgres que pueden llegar a pantalla desde una llamada RPC
		// directa (onboarding, ajustes). El detalle (SQL, nombre de restricción) va a Sentry.
		switch (error.code) {
			// JWT caducado o inválido: PostgREST lo rechaza antes de entrar en la función.
			case "PGRST301":
				return "Tu sesión caducó. Cierra y vuelve a abrir la app.";
			// Permiso denegado / política RLS.
			case "42501":
				return "No tienes permiso para hacer ese cambio.";
			// Violación de unicidad.
			case "23505":
				return "Eso ya existe.";
			// Se esperaba una fila y no había ninguna.
			case "PGRST116":
				return "No se encontró lo que buscabas. Puede que ya no exista.";
		}
	}
	return GENERIC_MESSAGE;
}
