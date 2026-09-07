import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/query-persist-client-core";
import {
	defaultShouldDehydrateQuery,
	type OmitKeyof,
	type Query,
	QueryClient,
} from "@tanstack/react-query";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { SYNC_MUTATION_KEY, syncPatches } from "@/lib/sync/mutation";

/**
 * Fábrica del `QueryClient`, no un singleton importado a ciegas: así el orden de arranque queda
 * expresado en código y no en "quién importa primero". `setMutationDefaults` se llama aquí, dentro
 * de la misma función síncrona que crea el cliente -- antes de que exista ninguna oportunidad de
 * hidratar la caché desde IndexedDB (eso solo ocurre después, cuando `PersistQueryClientProvider`
 * monta y llama a `persistQueryClient` en un efecto).
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
	queryClient.setMutationDefaults(SYNC_MUTATION_KEY, {
		mutationFn: syncPatches,
		scope: { id: "sync" },
	});

	return queryClient;
}

export const queryClient = createSyncQueryClient();

/**
 * idb-keyval como storage subyacente (D-022): expone `get/set/del` sobre un único par
 * object-store/IndexedDB por defecto, que es exactamente lo que pide un persistidor -- una clave,
 * un blob serializado. Vitest/jsdom no implementa IndexedDB, pero eso no es un problema aquí:
 * ninguna de estas funciones toca la base hasta que `PersistQueryClientProvider` las invoca de
 * verdad al montar, y los tests unitarios de esta fase no montan ese proveedor.
 */
const persister = createAsyncStoragePersister({
	key: "market-list-cache",
	storage: {
		getItem: async (key) => (await idbGet(key)) ?? null,
		setItem: (key, value) => idbSet(key, value),
		removeItem: (key) => idbDel(key),
	},
});

/** Las cuatro tablas del hogar (arquitectura §2.1) son lo único que este persistidor guarda. */
const PERSISTED_QUERY_KEY_PREFIXES = new Set([
	"supermarkets",
	"categories",
	"products",
	"list_items",
]);

function isPersistedTableQuery(query: Query): boolean {
	return PERSISTED_QUERY_KEY_PREFIXES.has(query.queryKey[0] as string);
}

export const persistOptions: OmitKeyof<
	PersistQueryClientOptions,
	"queryClient"
> = {
	persister,
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
		// reemplace. Lo que sí hay que sobrevivir a un cierre de la app es la cola de mutaciones,
		// que persiste aparte por el propio `PersistQueryClientProvider` (mutationCache), no por
		// esta condición.
		shouldDehydrateQuery: (query) =>
			isPersistedTableQuery(query) && defaultShouldDehydrateQuery(query),
	},
};
