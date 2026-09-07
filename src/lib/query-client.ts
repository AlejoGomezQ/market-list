import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/query-persist-client-core";
import {
	defaultShouldDehydrateMutation,
	defaultShouldDehydrateQuery,
	type OmitKeyof,
	type Query,
	QueryClient,
} from "@tanstack/react-query";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { cacheStore, queueStore } from "@/lib/sync/idb-stores";
import {
	SYNC_MUTATION_KEY,
	syncPatches,
	syncRetry,
	syncRetryDelay,
} from "@/lib/sync/mutation";

/**
 * Fábrica del `QueryClient`, no un singleton importado a ciegas: así el orden de arranque queda
 * expresado en código y no en "quién importa primero". `setMutationDefaults` se llama aquí, dentro
 * de la misma función síncrona que crea el cliente -- antes de que exista ninguna oportunidad de
 * hidratar la caché desde IndexedDB (eso solo ocurre después, cuando `PersistQueryClientProvider`
 * monta y llama a `persistQueryClient` en un efecto, y cuando `startOutboxQueue`, en
 * `sync/queue.ts`, restaura la cola por su cuenta desde `main.tsx`).
 *
 * Es la regla no negociable de CLAUDE.md: una mutación rehidratada busca su `mutationFn` por
 * `mutationKey` en los defaults del cliente; si todavía no está registrada, se reanuda sin nada
 * que ejecutar y el parche pendiente se pierde en silencio.
 */
export function createSyncQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			// CLAUDE.md: "Cuatro consultas persistidas... con gcTime: Infinity". Como global default
			// además de explícito en cada queryOptions (household-tables.ts): hoy solo hay esas
			// cuatro consultas en la app, así que un valor por defecto y uno explícito dicen lo mismo
			// dos veces a propósito, no es una segunda fuente de verdad que se pueda desincronizar.
			queries: { gcTime: Number.POSITIVE_INFINITY },
		},
	});

	// Ver comentario de cabecera: esta llamada tiene que ocurrir antes de cualquier hidratación.
	// `retry`/`retryDelay` son la clasificación de errores y el backoff de §5.1/§5.2
	// (`sync/mutation.ts`, `sync/errors.ts`); van aquí y no en `useSyncMutation` por la misma razón
	// que `mutationFn`: una mutación rehidratada los busca en los defaults, no en el hook.
	queryClient.setMutationDefaults(SYNC_MUTATION_KEY, {
		mutationFn: syncPatches,
		scope: { id: "sync" },
		retry: syncRetry,
		retryDelay: syncRetryDelay,
	});

	return queryClient;
}

export const queryClient = createSyncQueryClient();

/**
 * idb-keyval como storage subyacente (D-022): expone `get/set/del` sobre un *object store* de
 * IndexedDB concreto -- que es exactamente lo que pide un persistidor: una clave, un blob
 * serializado. Vitest/jsdom no implementa IndexedDB, pero eso no es un problema aquí: ninguna de
 * estas funciones toca la base hasta que algo las invoca de verdad (`PersistQueryClientProvider`
 * al montar, o `startOutboxQueue` en `sync/queue.ts`), y los tests unitarios de esta fase no montan
 * ese proveedor ni llaman a esa función.
 */
function createIdbPersister(key: string, store: typeof cacheStore) {
	return createAsyncStoragePersister({
		key,
		storage: {
			getItem: async (k) => (await idbGet(k, store)) ?? null,
			setItem: (k, value) => idbSet(k, value, store),
			removeItem: (k) => idbDel(k, store),
		},
	});
}

/** Las cuatro tablas del hogar (arquitectura §2.1) son lo único que persiste la caché. */
const PERSISTED_QUERY_KEY_PREFIXES = new Set([
	"supermarkets",
	"categories",
	"products",
	"list_items",
]);

function isPersistedTableQuery(query: Query): boolean {
	return PERSISTED_QUERY_KEY_PREFIXES.has(query.queryKey[0] as string);
}

/**
 * D-030/§8.1: "la caché es desechable, la cola de salida no ... viven en almacenes de IndexedDB
 * separados y con versionado independiente". Antes de esta fase, un único persistidor guardaba
 * consultas Y mutaciones pausadas en el mismo *object store* -- `dehydrateOptions` solo filtraba
 * `shouldDehydrateQuery`, así que `shouldDehydrateMutation` caía al default de la librería
 * (`defaultShouldDehydrateMutation`, que persiste toda mutación pausada) y la cola de salida
 * viajaba dentro de la misma clave `market-list-cache` que la caché desechable. Ahora son dos
 * `Persister` independientes, cada uno con su propio *object store* (`sync/idb-stores.ts`), su
 * propio `buster` y cada uno vetando explícitamente lo que no es suyo -- no basta con que uno filtre
 * lo que sí persiste, si el otro se queda con el default también persistiría lo mismo dos veces.
 *
 * `PersistQueryClientProvider` (`App.tsx`) solo acepta un `Persister`, así que se le da el de la
 * caché -- es el que necesita bloquear el primer render con `isRestoring` mientras hidrata
 * (`IsRestoringProvider`). El de la cola se restaura y suscribe a mano desde `main.tsx`
 * (`sync/queue.ts`, `startOutboxQueue`): no bloquea nada, y tiene que arrancar cuanto antes para
 * que "subir antes de bajar" (estrategia_sincronizacion §3.2) no dependa de que React haya
 * terminado de montar.
 */
const cachePersister = createIdbPersister("market-list-cache", cacheStore);
const queuePersister = createIdbPersister("market-list-queue", queueStore);

export const persistOptions: OmitKeyof<
	PersistQueryClientOptions,
	"queryClient"
> = {
	persister: cachePersister,
	// D-030/§8.1: la caché es desechable y no expira por tiempo -- se descarta por versión de
	// esquema (buster), nunca por edad, porque puede ser la única copia offline que hay.
	maxAge: Number.POSITIVE_INFINITY,
	// §8.2/D-030: clave de versión de esquema. Subir este valor descarta la caché entera sin
	// preguntar, que es la respuesta correcta ante una caché escrita por una versión anterior.
	buster: "v1",
	dehydrateOptions: {
		// Decisión explícita (Fase 2a): solo se persisten las cuatro consultas de tabla del hogar,
		// y de ellas solo el estado 'success' (comportamiento por defecto de
		// `defaultShouldDehydrateQuery`). Una consulta en error o pendiente no tiene datos que
		// valga la pena reponer al arrancar -- son exactamente los casos sin `data` usable -- y
		// dejarla fuera evita repintar un error viejo antes de que el primer fetch real la
		// reemplace.
		shouldDehydrateQuery: (query) =>
			isPersistedTableQuery(query) && defaultShouldDehydrateQuery(query),
		// Fase 6/D-030: la caché nunca guarda mutaciones -- eso es lo único que guarda el
		// persistidor de la cola (`queuePersistOptions`, más abajo). Sin este veto explícito, el
		// default de la librería (`isPaused`) volvería a mezclar los dos almacenes.
		shouldDehydrateMutation: () => false,
	},
};

/**
 * El persistidor de la cola de salida (`sync/queue.ts` lo consume, no `App.tsx`). Simétrico al de
 * arriba: nunca guarda consultas, solo mutaciones pausadas -- el comportamiento por defecto de la
 * librería (`defaultShouldDehydrateMutation`), que es exactamente "lo que todavía no se pudo
 * enviar". Versionado independiente (D-030): una subida de `buster` en la caché de consultas no
 * debe poder llevarse por delante cambios sin enviar, así que este `buster` es su propia constante,
 * no la misma que la de arriba aunque hoy compartan el mismo valor.
 */
export const queuePersistOptions: OmitKeyof<
	PersistQueryClientOptions,
	"queryClient"
> = {
	persister: queuePersister,
	maxAge: Number.POSITIVE_INFINITY,
	buster: "v1",
	dehydrateOptions: {
		shouldDehydrateQuery: () => false,
		shouldDehydrateMutation: defaultShouldDehydrateMutation,
	},
};
