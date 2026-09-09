import { z } from "zod";
import { AppError, isPostgresRaise } from "@/lib/errors";
import { getHouseholdLink, type HouseholdLink } from "@/lib/household-link";
import { supabase, supabaseConfigError } from "@/lib/supabase";

/**
 * `create_household`, `join_household` (Fase 1b) y `regenerate_household_code` (Fase 2b) llamadas
 * directas por RPC, fuera de la mutación única de sincronización (`src/lib/sync/mutation.ts`).
 *
 * Encajarlas en `syncPatches`/`sync_push` no tenía sentido: no son parches `{entidad, id, ts,
 * campos}` sobre una de las cuatro tablas del hogar, son altas de membresía que ni siquiera tienen
 * un `household_id` todavía cuando se llaman (crear/unirse es exactamente lo que lo consigue).
 * Tampoco son offline-first como el resto de escrituras: no existe "crear hogar sin red" ni
 * "unirse sin red" -- ambas necesitan que el servidor genere o valide el código en el momento --
 * así que no hay optimismo que perder por llamarlas aparte, y RNF-001 (cero indicador de carga)
 * habla de las operaciones *frecuentes*; onboarding se hace una vez por dispositivo.
 */

const createHouseholdResultSchema = z.object({
	household_id: z.uuid(),
	name: z.string().min(1),
	join_code: z.string().min(1),
});

const joinHouseholdResultSchema = z.discriminatedUnion("joined", [
	z.object({
		joined: z.literal(true),
		household_id: z.uuid(),
		name: z.string().min(1),
		join_code: z.string().min(1),
	}),
	z.object({ joined: z.literal(false), error: z.string() }),
]);

const regenerateResultSchema = z.object({
	household_id: z.uuid(),
	join_code: z.string().min(1),
});

const leaveResultSchema = z.object({ left: z.literal(true) });

const listHouseholdsResultSchema = z.array(
	z.object({
		household_id: z.uuid(),
		name: z.string().min(1),
		join_code: z.string().min(1),
	}),
);

const copyCatalogResultSchema = z.object({
	supermarkets_created: z.number().int().nonnegative(),
	categories_created: z.number().int().nonnegative(),
	products_copied: z.number().int().nonnegative(),
});

/**
 * `p_household_id` explícito (D-048): con multi-hogar (D-043) un dispositivo pertenece a varios
 * hogares, así que el servidor ya no puede derivar "el hogar del llamador". El parámetro es
 * opcional y cae al hogar activo del vínculo local para no romper los llamadores que aún no pasan
 * el id; la Fase C lo pasa siempre (`regenerateHouseholdCode(activeId)`).
 */
function requireHouseholdId(householdId?: string): string {
	const id = householdId ?? getHouseholdLink()?.householdId;
	if (!id) {
		throw new AppError("No hay ningún hogar vinculado en este dispositivo.");
	}
	return id;
}

function requireSupabase() {
	if (!supabase) {
		throw new Error(supabaseConfigError ?? "Supabase no está configurado.");
	}
	return supabase;
}

export type CreatedHousehold = {
	householdId: string;
	name: string;
	joinCode: string;
};

export async function createHousehold(name: string): Promise<CreatedHousehold> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("create_household", {
		p_name: name,
	});
	if (error) throw error;
	const result = createHouseholdResultSchema.parse(data);
	return {
		householdId: result.household_id,
		name: result.name,
		joinCode: result.join_code,
	};
}

/** Lanza con el mensaje "código inválido" si el código no corresponde a ningún hogar. */
export async function joinHousehold(code: string): Promise<CreatedHousehold> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("join_household", { p_code: code });
	if (error) {
		// El límite de intentos (household_join_attempts, arquitectura §5) es un mensaje esperado,
		// no un fallo que investigar: se relanza como AppError para que onboarding lo muestre tal
		// cual y `reportError` no lo mande a Sentry.
		if (isPostgresRaise(error) && /demasiados intentos/i.test(error.message)) {
			throw new AppError(
				"Demasiados intentos. Espera un momento antes de volver a probar.",
			);
		}
		throw error;
	}
	const result = joinHouseholdResultSchema.parse(data);
	if (!result.joined) {
		throw new AppError("Ese código no corresponde a ningún hogar.");
	}
	return {
		householdId: result.household_id,
		name: result.name,
		joinCode: result.join_code,
	};
}

export async function regenerateHouseholdCode(
	householdId?: string,
): Promise<string> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("regenerate_household_code", {
		p_household_id: requireHouseholdId(householdId),
	});
	if (error) throw error;
	return regenerateResultSchema.parse(data).join_code;
}

/**
 * Sale del hogar (D-014): borra la membresía de este dispositivo en el servidor. La limpieza de los
 * datos locales (vínculo en localStorage, caché e IndexedDB) la hace quien llama, tras el OK --
 * `ajustes-screen.tsx`. Para volver a entrar hace falta el código.
 */
export async function leaveHousehold(householdId?: string): Promise<void> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("leave_household", {
		p_household_id: requireHouseholdId(householdId),
	});
	if (error) throw error;
	leaveResultSchema.parse(data);
}

/**
 * Membresías del llamador (D-053): la fuente de verdad del selector de hogar. El vínculo local
 * basta para el camino feliz; esto lo reconcilia (poda hogares de los que te expulsaron, D-040).
 */
export async function listHouseholds(): Promise<HouseholdLink[]> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("list_households");
	if (error) throw error;
	return listHouseholdsResultSchema.parse(data).map((h) => ({
		householdId: h.household_id,
		name: h.name,
		joinCode: h.join_code,
	}));
}

export type CopyCatalogResult = {
	supermarketsCreated: number;
	categoriesCreated: number;
	productsCopied: number;
};

/**
 * Copia el catálogo de `sourceId` a `targetId` (D-049/D-050). Operación en línea y transaccional:
 * si falla, no deja nada a medias. Exige ser miembro de ambos hogares (D-051, lo valida el
 * servidor). Idempotente: repetir la copia devuelve todo a cero.
 */
export async function copyCatalog(
	sourceId: string,
	targetId: string,
	opts?: { copySupermarkets?: boolean; copyCategories?: boolean },
): Promise<CopyCatalogResult> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("copy_catalog", {
		p_source_household: sourceId,
		p_target_household: targetId,
		p_copy_supermarkets: opts?.copySupermarkets ?? true,
		p_copy_categories: opts?.copyCategories ?? true,
	});
	if (error) throw error;
	const result = copyCatalogResultSchema.parse(data);
	return {
		supermarketsCreated: result.supermarkets_created,
		categoriesCreated: result.categories_created,
		productsCopied: result.products_copied,
	};
}
