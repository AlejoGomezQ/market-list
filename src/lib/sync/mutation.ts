import { useMutation } from "@tanstack/react-query";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import type { SyncPatch } from "@/schemas/patch";

export const SYNC_MUTATION_KEY = ["sync"] as const;

/**
 * La única función de escritura real: envía el lote entero de parches a `sync_push` en una sola
 * llamada (estrategia_sincronizacion §4.3, "un lote, sin coalescencia"). Se exporta aparte de
 * `useSyncMutation` para poder registrarla con `setMutationDefaults` (`src/lib/query-client.ts`)
 * sin depender de que un componente haya montado el hook primero.
 */
export async function syncPatches(patches: SyncPatch[]): Promise<void> {
	if (!supabase) {
		// Config permanente rota -> cuarentena (estrategia_sincronizacion §5.1), no reintento ciego.
		throw new Error(supabaseConfigError ?? "Supabase no está configurado.");
	}
	const { error } = await supabase.rpc("sync_push", { p_patches: patches });
	if (error) throw error;
}

/**
 * Una sola mutación para toda la app (CLAUDE.md, D-0xx de sincronización): `mutationKey: ['sync']`
 * y `scope: {id: 'sync'}` para que todas las llamadas se sirialicen (estrategia_sincronizacion
 * §4.2) -- un `list_item` no puede adelantar al producto al que apunta. El `mutationFn` real se
 * registra una sola vez vía `setMutationDefaults` en `src/lib/query-client.ts`; este hook no repite
 * la función, solo dispara la mutación ya definida.
 */
export function useSyncMutation() {
	return useMutation<void, Error, SyncPatch[]>({
		mutationKey: SYNC_MUTATION_KEY,
		scope: { id: "sync" },
	});
}
