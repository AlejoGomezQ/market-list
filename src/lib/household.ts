import { z } from "zod";
import { AppError, isPostgresRaise } from "@/lib/errors";
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

export async function regenerateHouseholdCode(): Promise<string> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("regenerate_household_code");
	if (error) throw error;
	return regenerateResultSchema.parse(data).join_code;
}

/**
 * Sale del hogar (D-014): borra la membresía de este dispositivo en el servidor. La limpieza de los
 * datos locales (vínculo en localStorage, caché e IndexedDB) la hace quien llama, tras el OK --
 * `ajustes-screen.tsx`. Para volver a entrar hace falta el código.
 */
export async function leaveHousehold(): Promise<void> {
	const client = requireSupabase();
	const { data, error } = await client.rpc("leave_household");
	if (error) throw error;
	leaveResultSchema.parse(data);
}
