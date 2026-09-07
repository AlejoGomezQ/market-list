import type { QueryClient } from "@tanstack/react-query";
import { householdTableKey } from "@/lib/queries/household-tables";
import { useSyncMutation } from "@/lib/sync/mutation";
import { applyLocalPatch } from "@/lib/sync/optimistic";
import type { SyncedRow } from "@/lib/sync/reducer";
import type { ListItem, Product } from "@/schemas/domain";
import type { SyncPatch } from "@/schemas/patch";

export interface NewProductInput {
	name: string;
	brand: string | null;
	categoryId: string | null;
	supermarketId: string | null;
}

type EditableProductFields = Partial<
	Pick<Product, "name" | "brand" | "category_id" | "supermarket_id">
>;

/** Alta de producto (RF-001): nunca agrega a la lista de mercado (RN-001, invariante #1). */
export function buildCreateProduct(
	householdId: string,
	input: NewProductInput,
	ts: string,
	id: string = crypto.randomUUID(),
): { row: Product; patch: SyncPatch } {
	const row: Product = {
		id,
		household_id: householdId,
		name: input.name,
		brand: input.brand,
		category_id: input.categoryId,
		supermarket_id: input.supermarketId,
		created_at: ts,
		updated_at: ts,
		deleted_at: null,
		field_updated_at: {
			name: ts,
			brand: ts,
			category_id: ts,
			supermarket_id: ts,
		},
	};
	const patch: SyncPatch = {
		entity: "products",
		id,
		ts,
		fields: {
			household_id: householdId,
			name: input.name,
			brand: input.brand,
			category_id: input.categoryId,
			supermarket_id: input.supermarketId,
		},
	};
	return { row, patch };
}

/** Editar (RF-002, RF-007, RF-008): parche solo con los campos que cambiaron frente al original
 * (arquitectura §4, "el cliente envía... solo los campos modificados"). */
export function buildUpdateProduct(
	product: Product,
	fields: EditableProductFields,
	ts: string,
): SyncPatch {
	return { entity: "products", id: product.id, ts, fields };
}

/**
 * Eliminar (RF-003): lápida absorbente sobre el producto. Si tenía un item activo en la lista de
 * mercado, C-004 dice que "el item activo se retira" -- se manda en el mismo lote, con
 * `removed_reason: 'removed'` (RF-010), el mismo motivo que "quitar de la lista" a mano.
 */
export function buildDeleteProduct(
	product: Product,
	activeListItem: ListItem | null,
	ts: string,
): SyncPatch[] {
	const patches: SyncPatch[] = [
		{ entity: "products", id: product.id, ts, fields: { deleted_at: ts } },
	];
	if (activeListItem) {
		patches.push({
			entity: "list_items",
			id: activeListItem.id,
			ts,
			fields: { removed_at: ts, removed_reason: "removed" },
		});
	}
	return patches;
}

export function useProductMutations(
	householdId: string,
	queryClient: QueryClient,
) {
	const sync = useSyncMutation();

	function create(input: NewProductInput): Product {
		const ts = new Date().toISOString();
		const { row, patch } = buildCreateProduct(householdId, input, ts);
		queryClient.setQueryData<Product[]>(
			householdTableKey("products", householdId),
			(rows = []) => [...rows, row],
		);
		sync.mutate([patch]);
		return row;
	}

	function update(product: Product, fields: EditableProductFields): void {
		if (Object.keys(fields).length === 0) return;
		const ts = new Date().toISOString();
		const patch = buildUpdateProduct(product, fields, ts);
		queryClient.setQueryData<Product[]>(
			householdTableKey("products", householdId),
			(rows = []) =>
				rows.map((row) =>
					row.id === product.id
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								patch,
							) as unknown as Product)
						: row,
				),
		);
		sync.mutate([patch]);
	}

	function remove(product: Product, activeListItem: ListItem | null): void {
		const ts = new Date().toISOString();
		const patches = buildDeleteProduct(product, activeListItem, ts);
		const [productPatch, listItemPatch] = patches;

		queryClient.setQueryData<Product[]>(
			householdTableKey("products", householdId),
			(rows = []) =>
				rows.map((row) =>
					row.id === product.id
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								productPatch,
							) as unknown as Product)
						: row,
				),
		);
		if (listItemPatch) {
			queryClient.setQueryData<ListItem[]>(
				householdTableKey("list_items", householdId),
				(rows = []) =>
					rows.map((row) =>
						row.id === listItemPatch.id
							? (applyLocalPatch(
									row as unknown as SyncedRow,
									listItemPatch,
								) as unknown as ListItem)
							: row,
					),
			);
		}
		sync.mutate(patches);
	}

	return { create, update, remove };
}
