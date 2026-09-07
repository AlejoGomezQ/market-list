import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { ensureAnonymousSession } from "@/lib/auth";
import { useHouseholdRealtime } from "@/lib/realtime";
import { deltaPull } from "@/lib/sync/delta-pull";

/**
 * Motor de sincronización de un hogar (estrategia_sincronizacion §3.5, §6.1): dispara el delta
 * pull en los cuatro momentos que documenta la estrategia -- arranque, recuperación de red, vuelta
 * a primer plano y reconexión del socket de Realtime -- y abre la suscripción de Realtime
 * (`realtime.ts`), que ahora funde en caché en vez de invalidar.
 *
 * La cola de salida (restaurar, reanudar mutaciones pausadas) NO vive aquí: arranca antes, desde
 * `main.tsx` (`sync/queue.ts`), porque no depende de que exista `householdId` ni de que `AppShell`
 * haya montado -- "subir antes de bajar" (§3.2) no debería esperar a un componente de React.
 */
export function useSyncEngine(
	householdId: string | undefined,
	queryClient: QueryClient,
): void {
	useEffect(() => {
		// Igual que `useHouseholdRealtime` (`realtime.ts`): Vitest/jsdom no implementa IndexedDB
		// (`sync/idb-stores.ts`, `sync/delta-pull.ts` la tocan de verdad), así que este efecto no
		// tiene nada seguro que hacer en modo test. No es una decisión de producto.
		if (import.meta.env.MODE === "test") return;
		if (!householdId) return;

		function runDeltaPull() {
			void deltaPull(queryClient, householdId as string);
		}

		// Arranque (§3.2, paso 3: "se lanza un delta pull desde last_sync_at").
		runDeltaPull();

		// Recuperación de red: `navigator.onLine` miente (§3.4), pero el evento `online` del
		// navegador sigue siendo la señal correcta para *intentarlo* -- si en realidad seguimos sin
		// red de verdad, el delta pull simplemente falla en silencio (`delta-pull.ts` ya lo trata
		// como best-effort) y el próximo disparador lo reintenta.
		function handleOnline() {
			void ensureAnonymousSession().catch(() => {});
			void queryClient.resumePausedMutations();
			runDeltaPull();
		}
		window.addEventListener("online", handleOnline);

		// Vuelta a primer plano (§3.5): en iOS una pestaña en segundo plano se congela y el socket
		// de Realtime muere en silencio -- no hay evento de desconexión que avisar, solo el hecho de
		// volver a estar visible.
		function handleVisibility() {
			if (document.visibilityState !== "visible") return;
			void ensureAnonymousSession().catch(() => {});
			void queryClient.resumePausedMutations();
			runDeltaPull();
		}
		document.addEventListener("visibilitychange", handleVisibility);

		return () => {
			window.removeEventListener("online", handleOnline);
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	}, [householdId, queryClient]);

	// Reconexión de socket (§6.1, cuarto disparador): `useHouseholdRealtime` llama a este callback
	// cada vez que el canal confirma 'SUBSCRIBED', incluida la primera vez -- un delta pull de más
	// en el arranque es idempotente y barato, y así no hace falta distinguir "primera conexión" de
	// "reconexión" en dos sitios distintos. Memoizado: `useHouseholdRealtime` reabre el canal cada
	// vez que esta función cambia de identidad, y no queremos resuscribirnos en cada render.
	const handleReconnect = useCallback(() => {
		if (!householdId) return;
		void deltaPull(queryClient, householdId);
	}, [householdId, queryClient]);

	useHouseholdRealtime(householdId, queryClient, handleReconnect);
}
