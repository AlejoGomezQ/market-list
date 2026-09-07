import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import {
	type Category,
	categorySchema,
	type ListItem,
	listItemSchema,
	type Product,
	productSchema,
	type Supermarket,
	supermarketSchema,
} from "@/schemas/domain";
import type { SyncedEntity } from "@/schemas/patch";

/**
 * Las cuatro consultas persistidas, una por tabla del hogar completo (CLAUDE.md; arquitectura
 * §1; plan_implementacion Fase 2a). La clave de consulta es `[tabla, householdId]`: todo filtro,
 * orden, agrupación y búsqueda se deriva en memoria sobre este resultado (`src/lib/selectors.ts`),
 * nunca como una consulta parametrizada aparte -- eso llenaría la caché de entradas efímeras que
 * dejan de funcionar sin red.
 */
export function householdTableKey(entity: SyncedEntity, householdId: string) {
	return [entity, householdId] as const;
}

async function fetchHouseholdTable<T>(
	table: SyncedEntity,
	householdId: string,
	schema: z.ZodType<T>,
): Promise<T[]> {
	if (!supabase) {
		throw new Error(
			supabaseConfigError ?? `Supabase no está configurado (tabla ${table}).`,
		);
	}
	const { data, error } = await supabase
		.from(table)
		.select("*")
		.eq("household_id", householdId);
	if (error) throw error;
	// Frontera Realtime/red (D-023): una fila con forma inesperada no debe reventar la app.
	return z.array(schema).parse(data);
}

export function supermarketsQuery(householdId: string) {
	return queryOptions({
		queryKey: householdTableKey("supermarkets", householdId),
		queryFn: () =>
			fetchHouseholdTable<Supermarket>(
				"supermarkets",
				householdId,
				supermarketSchema,
			),
		gcTime: Number.POSITIVE_INFINITY,
	});
}

export function categoriesQuery(householdId: string) {
	return queryOptions({
		queryKey: householdTableKey("categories", householdId),
		queryFn: () =>
			fetchHouseholdTable<Category>("categories", householdId, categorySchema),
		gcTime: Number.POSITIVE_INFINITY,
	});
}

export function productsQuery(householdId: string) {
	return queryOptions({
		queryKey: householdTableKey("products", householdId),
		queryFn: () =>
			fetchHouseholdTable<Product>("products", householdId, productSchema),
		gcTime: Number.POSITIVE_INFINITY,
	});
}

export function listItemsQuery(householdId: string) {
	return queryOptions({
		queryKey: householdTableKey("list_items", householdId),
		queryFn: () =>
			fetchHouseholdTable<ListItem>("list_items", householdId, listItemSchema),
		gcTime: Number.POSITIVE_INFINITY,
	});
}
