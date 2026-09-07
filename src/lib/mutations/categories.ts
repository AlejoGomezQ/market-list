import type { QueryClient } from "@tanstack/react-query";
import { householdTableKey } from "@/lib/queries/household-tables";
import { useSyncMutation } from "@/lib/sync/mutation";
import { applyLocalPatch } from "@/lib/sync/optimistic";
import type { SyncedRow } from "@/lib/sync/reducer";
import type { Category, Product } from "@/schemas/domain";
import type { SyncPatch } from "@/schemas/patch";

/**
 * Administración de categorías desde Ajustes (D-041): alta, renombrar, borrar y reordenar la
 * lista global. El ARF y la arquitectura no dejaron una fila de operaciones explícita para
 * categorías (solo llegó con D-041, después de escrito el resto del documento); este archivo sigue
 * el mismo patrón que ya usa `sync_apply_catalog_patch` para supermarkets/products -- alta o
 * parche sobre `categories`, en el mismo lote atómico que cualquier efecto secundario.
 */

export function buildCreateCategory(
	householdId: string,
	name: string,
	position: number,
	ts: string,
	id: string = crypto.randomUUID(),
): { row: Category; patch: SyncPatch } {
	const row: Category = {
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
		entity: "categories",
		id,
		ts,
		fields: { household_id: householdId, name, position },
	};
	return { row, patch };
}

export function buildRenameCategory(
	category: Category,
	name: string,
	ts: string,
): SyncPatch {
	return { entity: "categories", id: category.id, ts, fields: { name } };
}

/**
 * Borrar una categoría no es destructivo para sus productos: al ser opcional (D-004), se
 * comportan igual que "Sin asignar" en supermercados (D-002) -- caen a "sin categoría" en el mismo
 * lote, en vez de quedar apuntando a una categoría fantasma que además rompería el orden por
 * categoría del Mercado (D-031, `selectors.ts`). No hay un D-0xx explícito para este caso
 * concreto; es la aplicación por simetría del mismo principio que sí está cerrado para
 * supermercados.
 */
export function buildDeleteCategory(
	category: Category,
	products: Product[],
	ts: string,
): SyncPatch[] {
	const patches: SyncPatch[] = [
		{ entity: "categories", id: category.id, ts, fields: { deleted_at: ts } },
	];
	for (const product of products) {
		if (product.deleted_at === null && product.category_id === category.id) {
			patches.push({
				entity: "products",
				id: product.id,
				ts,
				fields: { category_id: null },
			});
		}
	}
	return patches;
}

/**
 * Reordenar (D-041) intercambia la `position` de la categoría con la de su vecina viva más
 * cercana en esa dirección -- un movimiento por toque, sin arrastrar. Devuelve `[]` si no hay
 * vecina (ya está en un extremo) o si el id no existe entre las vivas.
 */
export function buildReorderCategory(
	categories: Category[],
	id: string,
	direction: "up" | "down",
	ts: string,
): SyncPatch[] {
	const live = [...categories]
		.filter((c) => c.deleted_at === null)
		.sort(
			(a, b) =>
				a.position - b.position || a.created_at.localeCompare(b.created_at),
		);
	const index = live.findIndex((c) => c.id === id);
	if (index === -1) return [];
	const otherIndex = direction === "up" ? index - 1 : index + 1;
	if (otherIndex < 0 || otherIndex >= live.length) return [];

	const current = live[index];
	const other = live[otherIndex];
	return [
		{
			entity: "categories",
			id: current.id,
			ts,
			fields: { position: other.position },
		},
		{
			entity: "categories",
			id: other.id,
			ts,
			fields: { position: current.position },
		},
	];
}

export function useCategoryMutations(
	householdId: string,
	queryClient: QueryClient,
) {
	const sync = useSyncMutation();

	function patchCategories(patches: SyncPatch[]) {
		const patchById = new Map(patches.map((p) => [p.id, p]));
		queryClient.setQueryData<Category[]>(
			householdTableKey("categories", householdId),
			(rows = []) =>
				rows.map((row) => {
					const patch = patchById.get(row.id);
					return patch
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								patch,
							) as unknown as Category)
						: row;
				}),
		);
	}

	function create(name: string, position: number): Category {
		const ts = new Date().toISOString();
		const { row, patch } = buildCreateCategory(householdId, name, position, ts);
		queryClient.setQueryData<Category[]>(
			householdTableKey("categories", householdId),
			(rows = []) => [...rows, row],
		);
		sync.mutate([patch]);
		return row;
	}

	function rename(category: Category, name: string): void {
		const ts = new Date().toISOString();
		const patch = buildRenameCategory(category, name, ts);
		patchCategories([patch]);
		sync.mutate([patch]);
	}

	function remove(category: Category, products: Product[]): void {
		const ts = new Date().toISOString();
		const patches = buildDeleteCategory(category, products, ts);
		const [categoryPatch, ...productPatches] = patches;
		patchCategories([categoryPatch]);
		if (productPatches.length > 0) {
			const productPatchById = new Map(productPatches.map((p) => [p.id, p]));
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

	function reorder(
		categories: Category[],
		id: string,
		direction: "up" | "down",
	): void {
		const ts = new Date().toISOString();
		const patches = buildReorderCategory(categories, id, direction, ts);
		if (patches.length === 0) return;
		patchCategories(patches);
		sync.mutate(patches);
	}

	return { create, rename, remove, reorder };
}
