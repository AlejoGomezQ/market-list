import { get as idbGet, set as idbSet } from "idb-keyval";
import { queueStore } from "@/lib/sync/idb-stores";
import type { SyncPatch } from "@/schemas/patch";

/**
 * Cuarentena (estrategia_sincronizacion §5.3): parches que `sync_push` rechaza de forma
 * permanente. Vive en el almacén de la cola (`idb-stores.ts`), no en la caché desechable -- es
 * justo la clase de dato que "nunca se borra solo y en silencio" (§9).
 *
 * Un módulo de estado con un pequeño *pub/sub* propio en vez de una entrada más de la caché de
 * TanStack Query: la cuarentena no es una consulta a un servidor (no tiene `queryFn`, nadie la
 * "refetchea"), es una lista que este módulo posee y persiste a mano -- usar `setQueryData` para
 * esto sería forzar la pieza equivocada a hacer un trabajo que ya sabe hacer un `Set` de listeners
 * (`useSyncExternalStore`, en `use-sync-status.ts`, es exactamente para esto).
 */
export interface QuarantinedPatch {
	patch: SyncPatch;
	/** Mensaje listo para pegar en un informe (§5.3: "poder pegarlo... no administrarlo"). */
	reason: string;
	quarantinedAt: string;
}

const QUARANTINE_KEY = "quarantine";

let snapshot: QuarantinedPatch[] = [];
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

export function subscribeQuarantine(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getQuarantineSnapshot(): QuarantinedPatch[] {
	return snapshot;
}

/** Repone el estado en memoria desde IndexedDB al arrancar la app. */
export async function loadQuarantine(): Promise<QuarantinedPatch[]> {
	const stored = await idbGet<QuarantinedPatch[]>(QUARANTINE_KEY, queueStore);
	snapshot = stored ?? [];
	notify();
	return snapshot;
}

/**
 * Reemplaza cualquier entrada previa para el mismo `patch.id` en vez de apilar otra: un reintento
 * de `syncPatches` (backoff tras un transitorio a medio bisectar, §5.2) puede volver a poner el
 * mismo parche en cuarentena más de una vez, y la franja de §9 muestra un conteo -- no tiene
 * sentido que un solo parche roto cuente dos veces.
 */
export async function addToQuarantine(entry: QuarantinedPatch): Promise<void> {
	snapshot = [
		...snapshot.filter((existing) => existing.patch.id !== entry.patch.id),
		entry,
	];
	notify();
	await idbSet(QUARANTINE_KEY, snapshot, queueStore);
}
