/**
 * El reductor único de filas remotas (estrategia_sincronizacion §6.2). La misma operación sirve
 * para una fila que llega por Realtime y una que llega por delta pull: upsert por id, descartando
 * campo a campo el valor cuyo `field_updated_at` sea anterior al que ya hay en local.
 *
 * Esa comparación por campo -- no por fila entera -- es lo que resuelve el eco: tu propia
 * escritura optimista puede volver por Realtime con un valor más viejo que el que ya tienes en
 * local, si mientras tanto volviste a tocar el mismo campo y ese parche sigue en la cola. Sin la
 * comparación, el servidor pisa tu propio cambio y lo ves deshacerse en pantalla.
 *
 * Es deliberado que sea el mismo mecanismo con el que se aplican las escrituras optimistas
 * (`src/lib/sync/optimistic.ts`): una escritura local se modela como una fila remota candidata con
 * su propio `field_updated_at` recién puesto a `ts`, y se funde contra el estado local con esta
 * misma función. Un solo camino de fusión para los dos sentidos del dato.
 */

/** Columnas que comparten las cuatro tablas sincronizadas (arquitectura §2.1). */
export interface SyncedRow {
	id: string;
	updated_at: string;
	field_updated_at: Record<string, string>;
	[field: string]: unknown;
}

/**
 * Funde `remote` sobre `local` campo a campo. Si no hay fila local (primera noticia de esa fila),
 * `remote` se acepta entera. `updated_at` -- el cursor del servidor (§6.3) -- se queda con el más
 * reciente de los dos, nunca se pisa hacia atrás.
 */
export function mergeRemoteRow<T extends SyncedRow>(
	local: T | undefined,
	remote: T,
): T {
	if (!local) return remote;

	const fieldUpdatedAt: Record<string, string> = { ...local.field_updated_at };
	const merged: T = { ...local };

	for (const [field, remoteTs] of Object.entries(remote.field_updated_at)) {
		const localTs = local.field_updated_at[field];
		if (!localTs || remoteTs > localTs) {
			merged[field as keyof T] = remote[field] as T[keyof T];
			fieldUpdatedAt[field] = remoteTs;
		}
	}

	merged.field_updated_at = fieldUpdatedAt;
	merged.updated_at =
		remote.updated_at > local.updated_at ? remote.updated_at : local.updated_at;
	return merged;
}
