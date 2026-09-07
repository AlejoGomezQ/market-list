import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { householdTableKey } from "@/lib/queries/household-tables";
import { supabase } from "@/lib/supabase";
import type { SyncedEntity } from "@/schemas/patch";

const SYNCED_TABLES: SyncedEntity[] = [
	"supermarkets",
	"categories",
	"products",
	"list_items",
];

/**
 * Realtime "desechable a propósito" (plan_implementacion Fase 4): ante cualquier evento en una de
 * las cuatro tablas del hogar, se invalida esa consulta persistida y TanStack Query la vuelve a
 * pedir entera -- una lectura de red deliberada, no una fusión en caché. D-028 ya dice que Realtime
 * nunca es la fuente de verdad y que hace falta delta pull; el reductor por campo
 * (`sync/reducer.ts`) que sustituye este `invalidateQueries` llega en la Fase 6, sobre la cola de
 * salida y el cursor de servidor que todavía no existen. Aquí basta con no perder los cambios del
 * otro dispositivo mientras la pestaña sigue abierta.
 */
export function useHouseholdRealtime(
	householdId: string | undefined,
	queryClient: QueryClient,
) {
	useEffect(() => {
		// Vitest deja las cuatro consultas de tabla golpeando el Supabase local de verdad (mismo
		// patrón ya asumido por CatalogoScreen/MercadoScreen: `.env.local` se carga también en
		// modo test), pero un socket de Realtime de verdad sí revienta jsdom -- el shim de
		// WebSocket de undici no es compatible con el bucle de eventos de jsdom y tira una
		// excepción no capturada. No es una decisión de producto, es no abrir un socket real desde
		// una prueba unitaria.
		if (import.meta.env.MODE === "test") return;
		if (!householdId || !supabase) return;
		const client = supabase;

		const channel = client.channel(`household:${householdId}`);
		for (const table of SYNCED_TABLES) {
			channel.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table,
					filter: `household_id=eq.${householdId}`,
				},
				() => {
					queryClient.invalidateQueries({
						queryKey: householdTableKey(table, householdId),
					});
				},
			);
		}
		channel.subscribe();

		return () => {
			void client.removeChannel(channel);
		};
	}, [householdId, queryClient]);
}
