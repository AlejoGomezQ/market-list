import type { QueryClient } from "@tanstack/react-query";
import { householdTableKey } from "@/lib/queries/household-tables";
import { useSyncMutation } from "@/lib/sync/mutation";
import { applyLocalPatch } from "@/lib/sync/optimistic";
import type { SyncedRow } from "@/lib/sync/reducer";
import type { Product, Supermarket } from "@/schemas/domain";
import type { SyncPatch } from "@/schemas/patch";

/**
 * Construcción pura del alta de un supermercado (RF-004). Funciones puras y comprobables sin
 * React; el hook de más abajo solo las conecta con la caché y la mutación única. El color no es
 * una columna del dominio (arquitectura §2.2): se deriva de `position` al pintar
 * (`selectors.ts#supermarketColorClass`), así que el alta es solo nombre + posición.
 */
export function buildCreateSupermarket(
	householdId: string,
	name: string,
	position: number,
	ts: string,
	id: string = crypto.randomUUID(),
): { row: Supermarket; patch: SyncPatch } {
	const row: Supermarket = {
		id,
		household_id: householdId,
		name,
		position,
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: { name: ts, position: ts },
	};
	const patch: SyncPatch = {
		entity: "supermarkets",
		id,
		ts,
		fields: { household_id: householdId, name, position },
	};
	return { row, patch };
}

/** RF-005: renombrar es un parche de un solo campo, como cualquier otra edición. */
export function buildRenameSupermarket(
	supermarket: Supermarket,
	name: string,
	ts: string,
): SyncPatch {
	return { entity: "supermarkets", id: supermarket.id, ts, fields: { name } };
}

/**
 * RF-006/D-002: borrar un supermercado no es destructivo para sus productos, caen en "Sin
 * asignar". La lápida del supermercado y la reasignación de cada producto afectado viajan en el
 * mismo lote atómico (arquitectura §3, fila "Eliminar supermercado"), no como mutaciones sueltas
 * que podrían quedar a medias si sync_push aplicara una y no la otra.
 */
export function buildDeleteSupermarket(
	supermarket: Supermarket,
	products: Product[],
	ts: string,
): SyncPatch[] {
	const patches: SyncPatch[] = [
		{
			entity: "supermarkets",
			id: supermarket.id,
			ts,
			fields: { deleted_at: ts },
		},
	];
	for (const product of products) {
		if (
			product.deleted_at === null &&
			product.supermarket_id === supermarket.id
		) {
			patches.push({
				entity: "products",
				id: product.id,
				ts,
				fields: { supermarket_id: null },
			});
		}
	}
	return patches;
}

/**
 * Hook fino: aplica la escritura optimista sobre las consultas persistidas afectadas y encola el
 * lote en la mutación única (CLAUDE.md). La lógica de qué parches construir vive arriba.
 */
export function useSupermarketMutations(
	householdId: string,
	queryClient: QueryClient,
) {
	const sync = useSyncMutation();

	function create(name: string, position: number): Supermarket {
		const ts = new Date().toISOString();
		const { row, patch } = buildCreateSupermarket(
			householdId,
			name,
			position,
			ts,
		);
		queryClient.setQueryData<Supermarket[]>(
			householdTableKey("supermarkets", householdId),
			(rows = []) => [...rows, row],
		);
		sync.mutate([patch]);
		return row;
	}

	function rename(supermarket: Supermarket, name: string): void {
		const ts = new Date().toISOString();
		const patch = buildRenameSupermarket(supermarket, name, ts);
		queryClient.setQueryData<Supermarket[]>(
			householdTableKey("supermarkets", householdId),
			(rows = []) =>
				rows.map((row) =>
					row.id === supermarket.id
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								patch,
							) as unknown as Supermarket)
						: row,
				),
		);
		sync.mutate([patch]);
	}

	function remove(supermarket: Supermarket, products: Product[]): void {
		const ts = new Date().toISOString();
		const patches = buildDeleteSupermarket(supermarket, products, ts);
		const [supermarketPatch, ...productPatches] = patches;
		const productPatchById = new Map(productPatches.map((p) => [p.id, p]));

		queryClient.setQueryData<Supermarket[]>(
			householdTableKey("supermarkets", householdId),
			(rows = []) =>
				rows.map((row) =>
					row.id === supermarket.id
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								supermarketPatch,
							) as unknown as Supermarket)
						: row,
				),
		);
		if (productPatchById.size > 0) {
			queryClient.setQueryData<Product[]>(
				householdTableKey("products", householdId),
				(rows = []) =>
					rows.map((row) => {
						const productPatch = productPatchById.get(row.id);
						return productPatch
							? (applyLocalPatch(
									row as unknown as SyncedRow,
									productPatch,
								) as unknown as Product)
							: row;
					}),
			);
		}
		sync.mutate(patches);
	}

	return { create, rename, remove };
}
