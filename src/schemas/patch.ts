import { z } from "zod";

/**
 * La unidad de la cola de salida (CLAUDE.md "Disciplina que sostiene el plan"; arquitectura §4;
 * estrategia_sincronizacion §4.1): `{entidad, id, ts, campos}`, con `ts` del momento en que el
 * usuario actuó, no del envío. Es literalmente el body que espera `sync_push`
 * (`supabase/migrations/20260906190000_sync_push.sql`), salvo el nombrado en inglés que ya usa esa
 * función (`entity`/`fields`).
 */
export const syncPatchSchema = z.object({
	entity: z.enum(["supermarkets", "categories", "products", "list_items"]),
	id: z.uuid(),
	ts: z.iso.datetime({ offset: true }),
	fields: z.record(z.string(), z.unknown()),
});
export type SyncPatch = z.infer<typeof syncPatchSchema>;

export type SyncedEntity = SyncPatch["entity"];
