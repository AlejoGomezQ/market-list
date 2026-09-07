import type { QueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import {
	getQuarantineSnapshot,
	subscribeQuarantine,
} from "@/lib/sync/quarantine";

/**
 * Los cuatro estados de §9 de estrategia_sincronizacion, en el orden en que se comprueban: la
 * cuarentena manda sobre todo lo demás (un cambio en cuarentena sigue sin subir aunque el resto de
 * la cola esté al día), y "sin conexión" sobre "subiendo" (una mutación pausada es la señal real de
 * falta de red -- §3.4, "la verdad la dan los fallos reales de petición" -- así que si hay alguna
 * pausada, no importa que otra esté en pleno vuelo).
 */
export type SyncStatus =
	| { kind: "idle" }
	| { kind: "uploading" }
	| { kind: "offline"; pendingCount: number }
	| { kind: "quarantined"; count: number };

/**
 * `paused:active` como clave primitiva en vez de un objeto nuevo en cada `getSnapshot` -- React
 * exige que `useSyncExternalStore` devuelva el mismo valor (por `Object.is`) mientras nada haya
 * cambiado de verdad; un objeto `{paused, active}` recién creado en cada llamada rompería esa
 * garantía y provocaría relecturas de más en cada render, aunque no haya habido ningún evento.
 */
function mutationCountsKey(queryClient: QueryClient): string {
	let paused = 0;
	let active = 0;
	for (const mutation of queryClient.getMutationCache().getAll()) {
		if (mutation.state.status !== "pending") continue;
		if (mutation.state.isPaused) paused++;
		else active++;
	}
	return `${paused}:${active}`;
}

/** Indicador de estado de sincronización (D-012, §9). Sin `setInterval` ni sondeo: se suscribe
 * directamente a la caché de mutaciones y a la cuarentena, y solo recalcula cuando una de las dos
 * cambia de verdad. */
export function useSyncStatus(queryClient: QueryClient): SyncStatus {
	const quarantineCount = useSyncExternalStore(
		subscribeQuarantine,
		() => getQuarantineSnapshot().length,
	);
	const countsKey = useSyncExternalStore(
		(onStoreChange) => queryClient.getMutationCache().subscribe(onStoreChange),
		() => mutationCountsKey(queryClient),
	);

	return useMemo(() => {
		if (quarantineCount > 0)
			return { kind: "quarantined", count: quarantineCount };
		const [pausedText, activeText] = countsKey.split(":");
		const paused = Number(pausedText);
		const active = Number(activeText);
		if (paused > 0) return { kind: "offline", pendingCount: paused };
		if (active > 0) return { kind: "uploading" };
		return { kind: "idle" };
	}, [quarantineCount, countsKey]);
}
