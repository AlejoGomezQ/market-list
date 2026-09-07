import { useMutation } from "@tanstack/react-query";
import { ensureAnonymousSession } from "@/lib/auth";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import {
	classifySyncError,
	computeBackoffDelayMs,
	SyncConfigError,
	SyncError,
} from "@/lib/sync/errors";
import { addToQuarantine } from "@/lib/sync/quarantine";
import type { SyncPatch } from "@/schemas/patch";

export const SYNC_MUTATION_KEY = ["sync"] as const;

/** Campos anulables de `products` (D-002, D-004): los únicos que §5.3 permite despejar en vez de
 * descartar el patch entero cuando la fila que referencian nunca llegó a crearse. */
const NULLABLE_PRODUCT_FK_FIELDS = ["category_id", "supermarket_id"] as const;

/** Una llamada real a `sync_push` con un lote (de uno o más parches). No atrapa errores: los deja
 * subir con el `status` HTTP puesto, que es lo único que necesita `classifySyncError`. */
async function pushBatch(patches: SyncPatch[]): Promise<void> {
	if (!supabase) {
		throw new SyncConfigError(
			supabaseConfigError ?? "Supabase no está configurado.",
		);
	}
	const { error, status } = await supabase.rpc("sync_push", {
		p_patches: patches,
	});
	if (error) throw new SyncError(error, status);
}

/** SQLSTATE 23503 (arquitectura §4.3, `list_items.product_id`/`products.category_id`/
 * `supermarket_id`): la única condición sobre la que actúa la regla de anular en vez de
 * descartar (§5.3). Un `raise exception` propio de `sync_push` llega como `P0001`, no esto. */
function isForeignKeyViolation(error: unknown): boolean {
	return error instanceof SyncError && error.code === "23503";
}

/** Si `patch` trae algún FK anulable no vacío, devuelve una copia con esos campos puestos a
 * `null`; si no trae ninguno, no hay nada que despejar y devuelve `null`. */
function stripNullableForeignKeys(patch: SyncPatch): SyncPatch | null {
	if (patch.entity !== "products") return null;
	const present = NULLABLE_PRODUCT_FK_FIELDS.filter(
		(field) => patch.fields[field] != null,
	);
	if (present.length === 0) return null;
	const fields = { ...patch.fields };
	for (const field of present) fields[field] = null;
	return { ...patch, fields };
}

/**
 * Un parche, ya identificado como permanentemente roto, va a cuarentena (§5.3). Antes de rendirse
 * del todo, si es un `products` con un FK anulable de por medio, se intenta una vez más sin esos
 * campos -- "sus referencias son anulables, basta con anularlas en lugar de descartar el
 * producto". Si esa segunda vuelta también falla, se pone en cuarentena el parche *original* (con
 * sus campos intactos), no el recortado: es lo que el usuario pidió, y lo que hay que poder pegar
 * en un informe.
 */
async function quarantineSinglePatch(
	patch: SyncPatch,
	error: SyncError | SyncConfigError,
): Promise<void> {
	if (isForeignKeyViolation(error)) {
		const stripped = stripNullableForeignKeys(patch);
		if (stripped) {
			try {
				await pushBatch([stripped]);
				return; // Se recuperó sin cuarentena.
			} catch {
				// Sigue roto incluso sin el FK: cae al camino normal de cuarentena, con el original.
			}
		}
	}
	await addToQuarantine({
		patch,
		reason: error.message,
		quarantinedAt: new Date().toISOString(),
	});
}

/**
 * Envía cada parche de `patches` por separado para aislar cuál de ellos es el que rompe
 * permanentemente el lote (`sync_push` es una única transacción atómica -- arquitectura §4.3 -- así
 * que el error del lote completo no dice cuál patch lo causó). Un parche dependiente de otro que
 * ya se puso en cuarentena (p. ej. un `list_item` cuyo producto nunca llegó a existir) falla aquí
 * por su propia cuenta -- una violación de clave foránea real contra Postgres, no un grafo de
 * dependencias que haya que mantener a mano -- y se pone en cuarentena también: "las dependientes
 * se van con ella" sale gratis de la restricción de la base, no de lógica nueva (§5.3).
 *
 * Si en mitad del recorrido un envío individual falla de forma transitoria o de sesión (la red se
 * cayó a medio bisecar, por ejemplo), se corta aquí y se relanza: los parches ya aplicados o ya en
 * cuarentena no se repiten en la próxima vuelta más que como reintentos idempotentes (D-025), y los
 * que faltan se reintentan con el lote original completo.
 */
async function bisectAndQuarantine(patches: SyncPatch[]): Promise<void> {
	for (const patch of patches) {
		try {
			await pushBatch([patch]);
		} catch (error) {
			if (!(error instanceof SyncError || error instanceof SyncConfigError)) {
				throw error;
			}
			const kind = classifySyncError(error);
			if (kind !== "permanent") throw error;
			await quarantineSinglePatch(patch, error);
		}
	}
}

/**
 * La única función de escritura real: intenta el lote entero en una sola llamada
 * (estrategia_sincronizacion §4.3). Se exporta aparte de `useSyncMutation` para poder registrarla
 * con `setMutationDefaults` (`src/lib/query-client.ts`) sin depender de que un componente haya
 * montado el hook primero.
 *
 * Clasifica el resultado (§5.1) y decide aquí mismo, no en la capa de reintento de TanStack Query:
 * - **Permanente**: nunca vuelve a lanzar. Bisecta el lote y pone en cuarentena lo que corresponda
 *   -- la mutación termina *resuelta*, porque ya se hizo cargo de todo lo que traía.
 * - **De sesión**: intenta refrescar con lo que ya existe de la Fase 2b (`ensureAnonymousSession`)
 *   y relanza el error -- `retry`/`retryDelay` en los defaults (`query-client.ts`) son los que
 *   deciden si hay un segundo intento.
 * - **Transitorio**: relanza sin más. El propio *retryer* de TanStack Query ya pausa la mutación
 *   sola cuando detecta que no hay red (`onlineManager`), antes incluso de intentar -- no hace
 *   falta reimplementar esa comprobación aquí.
 */
export async function syncPatches(patches: SyncPatch[]): Promise<void> {
	try {
		await pushBatch(patches);
	} catch (error) {
		if (!(error instanceof SyncError || error instanceof SyncConfigError)) {
			throw error;
		}
		const kind = classifySyncError(error);
		if (kind === "permanent") {
			if (patches.length === 1) {
				await quarantineSinglePatch(patches[0], error);
				return;
			}
			await bisectAndQuarantine(patches);
			return;
		}
		if (kind === "session") {
			// Comprobación de sesión antes de reintentar (§7): reutiliza la Fase 2b tal cual, sin
			// reimplementar la distinción entre "sin red" y "sesión inválida de verdad" que ya
			// resuelve `ensureAnonymousSession`/GoTrueClient.
			await ensureAnonymousSession().catch(() => {});
		}
		throw error;
	}
}

/**
 * Una sola mutación para toda la app (CLAUDE.md, D-0xx de sincronización): `mutationKey: ['sync']`
 * y `scope: {id: 'sync'}` para que todas las llamadas se sirialicen (estrategia_sincronizacion
 * §4.2) -- un `list_item` no puede adelantar al producto al que apunta. El `mutationFn` real y el
 * `retry`/`retryDelay` de más abajo se registran una sola vez vía `setMutationDefaults` en
 * `src/lib/query-client.ts`; este hook no repite nada de eso, solo dispara la mutación ya definida.
 */
export function useSyncMutation() {
	return useMutation<void, Error, SyncPatch[]>({
		mutationKey: SYNC_MUTATION_KEY,
		scope: { id: "sync" },
	});
}

/**
 * `retry`/`retryDelay` de la mutación única (§5.1, §5.2), registrados junto al `mutationFn` en
 * `setMutationDefaults`. `syncPatches` nunca relanza un error permanente (lo resuelve él mismo, ver
 * arriba), así que la rama `permanent -> false` de aquí es cinturón y tirantes, no el camino
 * real -- pero es barato dejarla y cuesta caro no tenerla si algún día `syncPatches` cambia.
 */
export const syncRetry = (failureCount: number, error: Error): boolean => {
	const kind = classifySyncError(error);
	if (kind === "permanent") return false;
	if (kind === "session") return failureCount < 1; // una sola vez, §5.1.
	return true; // transitorio: indefinido, "es una cola, no tiene prisa".
};

export const syncRetryDelay = (failureCount: number, error: Error): number => {
	if (classifySyncError(error) === "session") return 0; // ya se refrescó en el catch de arriba.
	return computeBackoffDelayMs(failureCount);
};
