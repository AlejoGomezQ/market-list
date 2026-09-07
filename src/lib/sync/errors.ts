/**
 * Clasificación de errores de `sync_push` (estrategia_sincronizacion §5.1) y el backoff que le
 * corresponde a cada tipo (§5.2). `syncPatches` (`sync/mutation.ts`) es el único llamador real;
 * este módulo es puro a propósito -- sin red, sin reloj real -- para poder probarlo determinista.
 */

/**
 * Envuelve el `{message, code}` que devuelve PostgREST junto al `status` HTTP de la respuesta
 * (`PostgrestBuilder` de `@supabase/postgrest-js` lo expone en `then()`, pero `supabase.rpc(...)`
 * tal como lo usa `syncPatches` solo desestructura `error`; hay que pedir también `status` para no
 * perder la señal que distingue 401/4xx/5xx). `code` es el SQLSTATE de Postgres cuando el fallo es
 * una restricción real (p. ej. `23503` violación de clave foránea) -- no cuando es un
 * `raise exception` propio de `sync_push`, que PostgREST reporta como `P0001`.
 */
export class SyncError extends Error {
	readonly status: number;
	readonly code?: string;

	constructor(pgError: { message: string; code?: string }, status: number) {
		super(pgError.message);
		this.name = "SyncError";
		this.status = status;
		this.code = pgError.code;
	}
}

/** Supabase no está configurado (`src/lib/supabase.ts`): roto de fábrica, no de red. */
export class SyncConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SyncConfigError";
	}
}

export type SyncErrorKind = "transient" | "session" | "permanent";

/**
 * Tabla de la §5.1, leída sobre lo único que un error de `sync_push` puede traer: el `status` HTTP
 * de la respuesta de PostgREST (`SyncError`) o, si ni siquiera hubo respuesta, nada (`status`
 * queda en `0`, tal como lo deja `PostgrestBuilder` ante un fallo de `fetch`).
 *
 * - **Transitorio**: sin red (`status` ausente/0), timeout, 5xx, Postgres no disponible.
 * - **De sesión**: 401 (JWT caducado).
 * - **Permanente**: el resto de 4xx -- 400 de una validación o un `raise exception` de
 *   `sync_push`, 403/42501 de RLS, 409 de una restricción única o de clave foránea.
 */
export function classifySyncError(error: unknown): SyncErrorKind {
	if (error instanceof SyncConfigError) return "permanent";
	if (!(error instanceof SyncError)) return "transient";
	const { status } = error;
	if (status === 401) return "session";
	if (status === 0 || status >= 500) return "transient";
	return "permanent";
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60_000;
const JITTER_RATIO = 0.3;

/**
 * Exponencial desde 1 s, duplicando, con tope de 60 s (§5.2). El jitter de ±30 % se aplica
 * *después* de aplicar el tope -- así que una vez alcanzado, el retraso real oscila en
 * `[42s, 78s]` en vez de quedarse siempre fijo en 60s, que es justo lo que evita que los dos
 * dispositivos reintenten sincronizados (la otra mitad de esa misma frase). `random` es
 * inyectable para que el cálculo sea determinista en pruebas, sin esperar tiempo real.
 */
export function computeBackoffDelayMs(
	failureCount: number,
	random: () => number = Math.random,
): number {
	const base = Math.min(BACKOFF_BASE_MS * 2 ** failureCount, BACKOFF_CAP_MS);
	const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
	return Math.round(base * jitter);
}
