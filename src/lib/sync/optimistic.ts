import type { QueryClient } from "@tanstack/react-query";
import { householdTableKey } from "@/lib/queries/household-tables";
import { useSyncMutation } from "@/lib/sync/mutation";
import { mergeRemoteRow, type SyncedRow } from "@/lib/sync/reducer";
import type { ListItem } from "@/schemas/domain";
import type { SyncPatch } from "@/schemas/patch";

/**
 * Aplica un parche local como si fuera una fila remota candidata: se construye una fila con solo
 * los campos tocados marcados con `patch.ts` en `field_updated_at`, y se funde contra `local` con
 * el mismo `mergeRemoteRow` que procesa Realtime y el delta pull (reducer.ts). Es el mismo motivo
 * por el que el eco no revierte una escritura optimista: si el usuario vuelve a tocar el campo
 * antes de que el eco llegue, el parche en cola ya dejó un `field_updated_at` más nuevo en local, y
 * `mergeRemoteRow` descarta el eco viejo exactamente igual que descartaría cualquier otro payload
 * anticuado.
 */
export function applyLocalPatch(
	local: SyncedRow,
	patch: Pick<SyncPatch, "ts" | "fields">,
): SyncedRow {
	const candidate: SyncedRow = {
		...local,
		...patch.fields,
		field_updated_at: Object.fromEntries(
			Object.keys(patch.fields).map((field) => [field, patch.ts]),
		),
	};
	return mergeRemoteRow(local, candidate);
}

/**
 * Ejemplo funcional de escritura optimista de punta a punta (plan_implementacion Fase 2a): marcar
 * un item de la lista es una de las tres operaciones de baja fricción de RNF-001, así que no puede
 * mostrar ningún indicador de carga. El cache se actualiza de inmediato con `applyLocalPatch` y el
 * parche se encola en la mutación única; cuando el eco vuelva por Realtime/delta pull (fases
 * futuras) pasará por el mismo reductor y no revertirá lo que ya se ve en pantalla.
 */
export function useMarkListItemChecked(
	householdId: string,
	queryClient: QueryClient,
) {
	const sync = useSyncMutation();

	return function markListItemChecked(item: ListItem, checked: boolean) {
		const ts = new Date().toISOString();
		const patch: SyncPatch = {
			entity: "list_items",
			id: item.id,
			ts,
			fields: { checked, checked_at: checked ? ts : null },
		};

		queryClient.setQueryData<ListItem[]>(
			householdTableKey("list_items", householdId),
			(rows = []) =>
				rows.map((row) =>
					row.id === item.id
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								patch,
							) as unknown as ListItem)
						: row,
				),
		);

		sync.mutate([patch]);
	};
}
