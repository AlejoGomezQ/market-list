import {
	persistQueryClientRestore,
	persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import type { QueryClient } from "@tanstack/react-query";
import { onlineManager } from "@tanstack/react-query";
import { ensureAnonymousSession } from "@/lib/auth";
import { queuePersistOptions } from "@/lib/query-client";
import { loadQuarantine } from "@/lib/sync/quarantine";

/**
 * Arranque de la cola de salida (estrategia_sincronizacion §3.2, pasos 1-2: "se hidrata la caché
 * ... se reanuda la cola de salida"). Se llama una sola vez desde `main.tsx`, junto a
 * `ensureAnonymousSession` -- no depende de que exista hogar vinculado ni de que React haya
 * montado nada: `setMutationDefaults` (`query-client.ts`) ya registró `mutationFn` de forma
 * síncrona al crear `queryClient`, así que es seguro restaurar mutaciones pausadas en cualquier
 * momento después de eso, y cuanto antes mejor para "subir antes de bajar".
 *
 * Orden dentro de la función, y por qué:
 * 1. `persistQueryClientRestore` -- rehidrata las mutaciones pausadas desde su propio almacén
 *    (`sync/idb-stores.ts`, D-030). Es el paso que, si `setMutationDefaults` no se hubiera llamado
 *    antes, dejaría cada mutación reanudada sin `mutationFn` y la perdería en silencio.
 * 2. Cuarentena (`loadQuarantine`) -- se repone en paralelo, no depende de lo anterior.
 * 3. Comprobación de sesión (§7): antes de intentar drenar, se asegura que hay sesión (o se
 *    reintenta crearla) con lo que ya existe de la Fase 2b. Best-effort: si falla por red, no es
 *    fatal -- `resumePausedMutations` de todos modos no llegará a ejecutar nada sin red, porque el
 *    *retryer* de cada mutación pausada vuelve a comprobar `onlineManager` antes de reintentar.
 * 4. `resumePausedMutations()` -- dispara la cola ya restaurada. Sin esta llamada explícita, una
 *    mutación pausada solo se reanuda sola ante una *transición* real de `onlineManager`/
 *    `focusManager` (offline->online, blur->focus); si la app abre ya en línea, no hay transición
 *    que dispare nada y la cola se quedaría pausada hasta el primer cambio de conectividad.
 * 5. `persistQueryClientSubscribe` -- a partir de aquí, cualquier mutación nueva que quede pausada
 *    (o que termine) se persiste sola. Se suscribe *después* de restaurar para no guardar de vuelta
 *    un estado a medio restaurar.
 */
export async function startOutboxQueue(
	queryClient: QueryClient,
): Promise<void> {
	await persistQueryClientRestore({ queryClient, ...queuePersistOptions });
	void loadQuarantine();

	await ensureAnonymousSession().catch((error) => {
		console.warn(
			"No se pudo confirmar la sesión antes de drenar la cola; se reintentará solo.",
			error,
		);
	});

	if (onlineManager.isOnline()) {
		void queryClient.resumePausedMutations();
	}

	persistQueryClientSubscribe({ queryClient, ...queuePersistOptions });
}
