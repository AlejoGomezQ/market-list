import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { householdTableKey } from "@/lib/queries/household-tables";
import { supabase } from "@/lib/supabase";
import { mergeRemoteRow, type SyncedRow } from "@/lib/sync/reducer";
import {
	categorySchema,
	listItemSchema,
	productSchema,
	supermarketSchema,
} from "@/schemas/domain";
import type { SyncedEntity } from "@/schemas/patch";

const TABLE_SCHEMAS = {
	supermarkets: supermarketSchema,
	categories: categorySchema,
	products: productSchema,
	list_items: listItemSchema,
} as const;

const SYNCED_TABLES = Object.keys(TABLE_SCHEMAS) as SyncedEntity[];

/**
 * Funde una fila entrante de Realtime en la consulta persistida correspondiente, con el mismo
 * reductor que usa el delta pull (`sync/reducer.ts`, `sync/delta-pull.ts`): estrategia_sincronizacion
 * §6.2, "un solo reductor" para las dos vías de bajada. `payload.new` ya trae la fila completa
 * (Realtime la incluye entera en INSERT/UPDATE sin depender de `REPLICA IDENTITY`); un `DELETE` no
 * puede llegar aquí en la práctica -- D-026 prohíbe el borrado físico de las cuatro tablas
 * sincronizadas -- pero si alguna vez ocurre (una limpieza manual, un bug), `payload.new` llega
 * vacío y no hay `id` que fundir: se ignora en vez de escribir una fila a medias.
 */
export function applyRealtimePayload(
	queryClient: QueryClient,
	entity: SyncedEntity,
	householdId: string,
	schema: (typeof TABLE_SCHEMAS)[SyncedEntity],
	rawRow: unknown,
): void {
	const parsed = schema.safeParse(rawRow);
	if (!parsed.success) return; // Frontera Realtime (D-023): fila con forma inesperada, se ignora.
	const remote = parsed.data as unknown as SyncedRow;

	queryClient.setQueryData<SyncedRow[]>(
		householdTableKey(entity, householdId),
		(rows = []) => {
			const index = rows.findIndex((row) => row.id === remote.id);
			if (index === -1) return [...rows, remote];
			const merged = mergeRemoteRow(rows[index], remote);
			const next = [...rows];
			next[index] = merged;
			return next;
		},
	);
}

/**
 * Suscripción de Realtime a las cuatro tablas del hogar (RF-016). Ya no es "desechable a
 * propósito" (Fase 4): cada evento se funde en la caché en memoria con `mergeRemoteRow`, sin volver
 * a leer de la red -- Realtime da la latencia baja, pero la fusión es la misma que usa el delta
 * pull, así que el eco de la propia escritura (§6.2) se resuelve igual venga por donde venga.
 *
 * `onReconnect` se dispara cada vez que el canal confirma suscripción ('SUBSCRIBED'), incluida la
 * primera vez: D-028/§6.1 dice que Realtime nunca es la fuente de verdad, así que cada
 * (re)conexión de socket es uno de los cuatro disparadores del delta pull (`sync/engine.ts`) --
 * "la red de seguridad" de lo que el socket se haya perdido mientras estuvo caído.
 */
export function useHouseholdRealtime(
	householdId: string | undefined,
	queryClient: QueryClient,
	onReconnect?: () => void,
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
		for (const entity of SYNCED_TABLES) {
			channel.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: entity,
					filter: `household_id=eq.${householdId}`,
				},
				(payload: { new: unknown }) => {
					applyRealtimePayload(
						queryClient,
						entity,
						householdId,
						TABLE_SCHEMAS[entity],
						payload.new,
					);
				},
			);
		}
		channel.subscribe((status) => {
			if (status === "SUBSCRIBED") onReconnect?.();
		});

		return () => {
			void client.removeChannel(channel);
		};
	}, [householdId, queryClient, onReconnect]);
}
