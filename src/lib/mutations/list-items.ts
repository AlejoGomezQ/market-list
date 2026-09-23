import type { QueryClient } from "@tanstack/react-query";
import {
	buildCreateProduct,
	type NewProductInput,
} from "@/lib/mutations/products";
import { householdTableKey } from "@/lib/queries/household-tables";
import { useSyncMutation } from "@/lib/sync/mutation";
import { applyLocalPatch } from "@/lib/sync/optimistic";
import type { SyncedRow } from "@/lib/sync/reducer";
import type { ListItem, Product } from "@/schemas/domain";
import type { SyncPatch } from "@/schemas/patch";

/**
 * Agregar, cambiar cantidad, quitar, finalizar y deshacer sobre `list_items` (arquitectura §3,
 * D-034, D-008, D-001, D-032). "Agregar" declara una intención con `quantity = 1`: nunca inserta
 * una segunda fila para el mismo producto porque el llamador solo ofrece "+" cuando
 * `indexActiveListItemsByProduct` (selectors.ts) no tiene ya un item activo para ese `product_id`
 * -- la mitad servidor de C-005 (`sync_merge_into_active_list_item`) sigue cubriendo el choque
 * entre dos dispositivos que agregan casi a la vez sin verse.
 */

export function buildAddToList(
	householdId: string,
	product: Product,
	ts: string,
	id: string = crypto.randomUUID(),
): { row: ListItem; patch: SyncPatch } {
	const row: ListItem = {
		id,
		household_id: householdId,
		product_id: product.id,
		quantity: 1,
		checked: false,
		checked_at: null,
		created_at: ts,
		updated_at: ts,
		removed_at: null,
		removed_reason: null,
		purchase_batch_id: null,
		purchase_total: null,
		field_updated_at: { product_id: ts, quantity: ts, checked: ts },
	};
	const patch: SyncPatch = {
		entity: "list_items",
		id,
		ts,
		fields: {
			household_id: householdId,
			product_id: product.id,
			quantity: 1,
			checked: false,
		},
	};
	return { row, patch };
}

/**
 * RF-011/D-010: cambiar la cantidad. Lleva `household_id`/`product_id` además de `quantity`
 * (igual que `buildAddToList`): si el alta original quedó en cuarentena, este parche de edición
 * es autosuficiente para dar de alta la fila en vez de reventar contra `sync_apply_list_item_patch`
 * por falta de `product_id` (bug de cuarentena en cascada). Server-side es un no-op seguro cuando
 * la fila ya existe -- ver verificación en el informe de este cambio.
 */
export function buildSetQuantity(
	item: ListItem,
	quantity: number,
	ts: string,
): SyncPatch {
	return {
		entity: "list_items",
		id: item.id,
		ts,
		fields: {
			household_id: item.household_id,
			product_id: item.product_id,
			quantity,
		},
	};
}

/** RF-010: quitar de la lista. El producto sigue en el catálogo (RN-003). Mismo motivo que
 * `buildSetQuantity` para llevar `household_id`/`product_id`. */
export function buildRemoveFromList(item: ListItem, ts: string): SyncPatch {
	return {
		entity: "list_items",
		id: item.id,
		ts,
		fields: {
			household_id: item.household_id,
			product_id: item.product_id,
			removed_at: ts,
			removed_reason: "removed",
		},
	};
}

/**
 * Finalizar compra (RF-017, D-001): recibe una lista EXPLÍCITA de ids, nunca "todo lo marcado
 * ahora mismo" (arquitectura §3). El llamador captura `itemIds` en el instante en que se pulsa el
 * botón, antes de abrir la confirmación -- es lo que hace determinista C-002: lo que el otro
 * dispositivo agregue o marque mientras la confirmación está abierta no está en este arreglo, así
 * que no entra en el lote aunque el usuario confirme más tarde.
 */
export function buildFinalizePurchase(
	items: ListItem[],
	ts: string,
	batchId: string,
	total?: number | null,
): SyncPatch[] {
	return items.map((item) => ({
		entity: "list_items" as const,
		id: item.id,
		ts,
		fields: {
			// household_id/product_id: igual que `buildSetQuantity`, hace el parche autosuficiente
			// si el alta original sigue en cuarentena.
			household_id: item.household_id,
			product_id: item.product_id,
			removed_at: ts,
			removed_reason: "purchased" as const,
			purchase_batch_id: batchId,
			// backlog §6: el total es opcional. Si no se registró, la clave no viaja en el parche
			// (nada que fusionar), no se manda como null.
			...(total != null ? { purchase_total: total } : {}),
		},
	}));
}

/**
 * Deshacer (D-032): mismos ids, otro lote, nada especial. Solo toca `removed_at` -- el servidor no
 * lo trata como lápida absorbente en `list_items` (arquitectura §4.1, C-006), así que un timestamp
 * posterior al de la finalización basta para resucitar el item vía el mismo LWW de siempre.
 */
export function buildUndoFinalize(items: ListItem[], ts: string): SyncPatch[] {
	return items.map((item) => ({
		entity: "list_items" as const,
		id: item.id,
		ts,
		// Un item resucitado no debe aparecer en el historial ni arrastrar un total.
		fields: {
			household_id: item.household_id,
			product_id: item.product_id,
			removed_at: null,
			purchase_batch_id: null,
			purchase_total: null,
		},
	}));
}

/**
 * Editar el total de una compra ya finalizada desde el Historial (backlog §6): corregir una cifra
 * mal tecleada o añadirla a una compra que se cerró sin ella. Un parche por lápida del lote con el
 * mismo `purchase_total` (así queda repetido en todas, como al finalizar); `null` lo borra. La
 * columna tiene `check (>= 0)` en la BD -- la UI solo deja teclear dígitos.
 */
export function buildSetPurchaseTotal(
	items: ListItem[],
	ts: string,
	total: number | null,
): SyncPatch[] {
	return items.map((item) => ({
		entity: "list_items" as const,
		id: item.id,
		ts,
		fields: {
			household_id: item.household_id,
			product_id: item.product_id,
			purchase_total: total,
		},
	}));
}

export function useListItemMutations(
	householdId: string,
	queryClient: QueryClient,
) {
	const sync = useSyncMutation();

	function patchListItems(patches: SyncPatch[]) {
		const patchById = new Map(patches.map((p) => [p.id, p]));
		queryClient.setQueryData<ListItem[]>(
			householdTableKey("list_items", householdId),
			(rows = []) =>
				rows.map((row) => {
					const patch = patchById.get(row.id);
					return patch
						? (applyLocalPatch(
								row as unknown as SyncedRow,
								patch,
							) as unknown as ListItem)
						: row;
				}),
		);
	}

	/**
	 * Finalizar/deshacer/editar total llegan desde la UI como `itemIds: string[]` (capturados en el
	 * instante del gesto, C-002) sin la fila completa a mano. Se resuelven contra la caché ya
	 * hidratada -- sin red -- para que los builders puedan mandar `household_id`/`product_id` y así
	 * ser autosuficientes si el alta original quedó en cuarentena. Un id que ya no está en caché se
	 * descarta en vez de reventar: no puede pasar en uso normal porque `itemIds` sale de esta misma
	 * consulta.
	 */
	function resolveItems(itemIds: string[]): ListItem[] {
		const rows =
			queryClient.getQueryData<ListItem[]>(
				householdTableKey("list_items", householdId),
			) ?? [];
		const byId = new Map(rows.map((row) => [row.id, row]));
		return itemIds
			.map((id) => byId.get(id))
			.filter((row): row is ListItem => row != null);
	}

	function addToList(product: Product): ListItem {
		const ts = new Date().toISOString();
		const { row, patch } = buildAddToList(householdId, product, ts);
		queryClient.setQueryData<ListItem[]>(
			householdTableKey("list_items", householdId),
			(rows = []) => [...rows, row],
		);
		sync.mutate([patch]);
		return row;
	}

	/** D-034: el mismo control agrega y fija cantidad. Bajar de 1 quita de la lista, no llega a 0. */
	function changeQuantity(item: ListItem, delta: 1 | -1): void {
		const nextQuantity = item.quantity + delta;
		const ts = new Date().toISOString();
		const patch =
			nextQuantity <= 0
				? buildRemoveFromList(item, ts)
				: buildSetQuantity(item, nextQuantity, ts);
		patchListItems([patch]);
		sync.mutate([patch]);
	}

	function removeFromList(item: ListItem): void {
		const ts = new Date().toISOString();
		const patch = buildRemoveFromList(item, ts);
		patchListItems([patch]);
		sync.mutate([patch]);
	}

	/** D-008: crear y agregar en un solo gesto -- dos filas, un único lote atómico. */
	function createAndAddToList(input: NewProductInput): {
		product: Product;
		item: ListItem;
	} {
		const ts = new Date().toISOString();
		const { row: product, patch: productPatch } = buildCreateProduct(
			householdId,
			input,
			ts,
		);
		const { row: item, patch: itemPatch } = buildAddToList(
			householdId,
			product,
			ts,
		);

		queryClient.setQueryData<Product[]>(
			householdTableKey("products", householdId),
			(rows = []) => [...rows, product],
		);
		queryClient.setQueryData<ListItem[]>(
			householdTableKey("list_items", householdId),
			(rows = []) => [...rows, item],
		);
		sync.mutate([productPatch, itemPatch]);
		return { product, item };
	}

	function finalizeSection(itemIds: string[], total?: number | null): void {
		if (itemIds.length === 0) return;
		const ts = new Date().toISOString();
		// D-024: el id del lote se genera en el cliente, una vez por finalización.
		const batchId = crypto.randomUUID();
		const patches = buildFinalizePurchase(
			resolveItems(itemIds),
			ts,
			batchId,
			total,
		);
		patchListItems(patches);
		sync.mutate(patches);
	}

	/** backlog §6: fijar o borrar (`null`) el total de una compra del historial. Optimista, sin spinner. */
	function setPurchaseTotal(itemIds: string[], total: number | null): void {
		if (itemIds.length === 0) return;
		const ts = new Date().toISOString();
		const patches = buildSetPurchaseTotal(resolveItems(itemIds), ts, total);
		patchListItems(patches);
		sync.mutate(patches);
	}

	function undoFinalize(itemIds: string[]): void {
		if (itemIds.length === 0) return;
		const ts = new Date().toISOString();
		const patches = buildUndoFinalize(resolveItems(itemIds), ts);
		patchListItems(patches);
		sync.mutate(patches);
	}

	return {
		addToList,
		changeQuantity,
		removeFromList,
		createAndAddToList,
		finalizeSection,
		setPurchaseTotal,
		undoFinalize,
	};
}
