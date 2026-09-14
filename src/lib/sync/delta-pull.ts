import type { QueryClient } from "@tanstack/react-query";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { z } from "zod";
import { householdTableKey } from "@/lib/queries/household-tables";
import { supabase } from "@/lib/supabase";
import { queueStore } from "@/lib/sync/idb-stores";
import { mergeRemoteRow, type SyncedRow } from "@/lib/sync/reducer";
import {
	categorySchema,
	listItemSchema,
	productSchema,
	supermarketSchema,
} from "@/schemas/domain";
import type { SyncedEntity } from "@/schemas/patch";

/**
 * Delta pull por cursor (estrategia_sincronizacion §6.1): "la red de seguridad" de Realtime, que
 * nunca es la fuente de verdad (D-028). Mismas cuatro tablas que `queries/household-tables.ts`,
 * pero acotadas a `updated_at > cursor` en vez de traer la tabla entera, y fundidas con
 * `mergeRemoteRow` -- el mismo reductor que usa Realtime (`realtime.ts`) -- en vez de reemplazar la
 * consulta.
 *
 * El cursor vive en el almacén de la cola (`sync/idb-stores.ts`), no en la caché desechable: es
 * exactamente el tipo de dato que D-030 protege de un `buster` de la caché -- perder el cursor no
 * pierde datos, pero fuerza a volver a bajar la tabla entera la próxima vez, y eso es justo lo que
 * este mecanismo existe para evitar.
 *
 * La clave lleva el `householdId` (D-044): un dispositivo puede seguir varios hogares y la
 * sincronización opera solo sobre el activo. Sin el hogar en la clave, cambiar de hogar reutilizaría
 * el cursor del anterior y se saltaría filas del nuevo en silencio (riesgo nº1 del plan multi-hogar,
 * §8.1). Dentro de un hogar se sigue indexando por tabla, porque cada una avanza a su propio ritmo.
 *
 * ponytail: no se migran los cursores del formato viejo `sync:cursor:<entity>`. Un huérfano en
 * IndexedDB es inocuo: como mucho, un delta pull completo de más la primera vez tras actualizar.
 */
export function cursorKey(householdId: string, entity: SyncedEntity): string {
	return `sync:cursor:${householdId}:${entity}`;
}

/** §6.3: margen de 5 s al guardar el cursor, para cubrir el hueco entre el `now()` de una
 * transacción y el momento en que se hace visible al confirmarse. Reprocesar unas pocas filas de
 * más no hace daño -- los upserts son idempotentes. */
const CURSOR_SAFETY_MARGIN_MS = 5000;

async function getCursor(
	householdId: string,
	entity: SyncedEntity,
): Promise<string | undefined> {
	return await idbGet<string>(cursorKey(householdId, entity), queueStore);
}

async function setCursor(
	householdId: string,
	entity: SyncedEntity,
	iso: string,
): Promise<void> {
	await idbSet(cursorKey(householdId, entity), iso, queueStore);
}

interface TableConfig {
	entity: SyncedEntity;
	// Las cuatro tablas comparten `id`/`updated_at`/`field_updated_at` (arquitectura §2.1); el
	// resto de columnas difiere entre ellas y no hace falta que TypeScript lo distinga aquí --
	// igual que `realtime.ts`, esta función solo mueve filas a través de `mergeRemoteRow`
	// (`SyncedRow`), nunca lee un campo de dominio concreto.
	schema: z.ZodType<SyncedRow>;
}

const TABLES: TableConfig[] = [
	{ entity: "supermarkets", schema: supermarketSchema as z.ZodType<SyncedRow> },
	{ entity: "categories", schema: categorySchema as z.ZodType<SyncedRow> },
	{ entity: "products", schema: productSchema as z.ZodType<SyncedRow> },
	{ entity: "list_items", schema: listItemSchema as z.ZodType<SyncedRow> },
];

async function pullTable(
	{ entity, schema }: TableConfig,
	householdId: string,
	queryClient: QueryClient,
): Promise<void> {
	if (!supabase) return;
	const cursor = await getCursor(householdId, entity);

	let request = supabase
		.from(entity)
		.select("*")
		.eq("household_id", householdId)
		.order("updated_at", { ascending: true });
	if (cursor) request = request.gt("updated_at", cursor);

	const { data, error } = await request;
	if (error) {
		// Best-effort (§6.1: "la red de seguridad"): un fallo aquí no debe tirar el resto del
		// arranque. El próximo disparador (online/foco/reconexión de Realtime) lo vuelve a intentar
		// desde el mismo cursor -- no se pierde nada por no avanzarlo.
		console.warn(`delta pull: fallo al traer ${entity}`, error);
		return;
	}

	// Frontera Realtime/red (D-023): una fila con forma inesperada no debe reventar la app; se
	// descarta esta vuelta entera para esa tabla y se reintenta en el próximo disparador.
	const parsed = z.array(schema).safeParse(data);
	if (!parsed.success) {
		console.warn(
			`delta pull: filas con forma inesperada en ${entity}`,
			parsed.error,
		);
		return;
	}
	if (parsed.data.length === 0) return;

	queryClient.setQueryData<SyncedRow[]>(
		householdTableKey(entity, householdId),
		(existing = []) => {
			const byId = new Map(existing.map((row) => [row.id, row]));
			for (const remote of parsed.data) {
				byId.set(remote.id, mergeRemoteRow(byId.get(remote.id), remote));
			}
			return Array.from(byId.values());
		},
	);

	const maxUpdatedAt = parsed.data.reduce(
		(max, row) => (row.updated_at > max ? row.updated_at : max),
		parsed.data[0].updated_at,
	);
	const nextCursor = new Date(
		new Date(maxUpdatedAt).getTime() - CURSOR_SAFETY_MARGIN_MS,
	).toISOString();
	await setCursor(householdId, entity, nextCursor);
}

/**
 * Aplica el delta pull a las cuatro tablas del hogar, en serie (no hay prisa ni razón para
 * paralelizar cuatro consultas pequeñas en un móvil). Se dispara en arranque, recuperación de red,
 * vuelta a primer plano y reconexión de Realtime (`sync/engine.ts`).
 */
export async function deltaPull(
	queryClient: QueryClient,
	householdId: string,
): Promise<void> {
	for (const table of TABLES) {
		await pullTable(table, householdId, queryClient);
	}
}
