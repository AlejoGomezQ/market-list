// Helpers de las pruebas de integración de Fase 1 (docs/plan_implementacion_v0.1.md, "Listo
// cuando"). Hablan directo con el Postgres local levantado por `supabase start` -- sin pasar por
// PostgREST ni GoTrue -- porque lo que hay que probar es sync_push, create_household y
// join_household, y esas son funciones de Postgres. No se usa pgTAP: el proyecto ya trae Vitest
// (CLAUDE.md) y un cliente `pg` de 30 líneas alcanza sin añadir un segundo test runner.
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const CONNECTION_STRING =
	process.env.SUPABASE_DB_URL ??
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type Patch = {
	entity: "supermarkets" | "categories" | "products" | "list_items";
	id: string;
	ts: string;
	fields: Record<string, unknown>;
};

export function patch(
	entity: Patch["entity"],
	id: string,
	ts: string,
	fields: Record<string, unknown>,
): Patch {
	return { entity, id, ts, fields };
}

/** ts de "ahora + offsetMs", para construir timestamps de parches relativos entre sí sin dormir. */
export function tsAt(offsetMs: number): string {
	return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Conecta como el usuario de auth.users indicado: `set role authenticated` + el claim `sub` que
 * lee auth.uid() (arquitectura §5), exactamente lo que haría PostgREST con un JWT real. A partir
 * de aquí la conexión queda sujeta a RLS de verdad, no como el superusuario `postgres` de
 * `supabase start`.
 */
async function actAsUser(client: Client, userId: string): Promise<void> {
	await client.query("set role authenticated");
	// is_local = false: el ajuste vive toda la sesión, no solo la transacción en curso, porque
	// cada test hace varias llamadas sueltas sobre la misma conexión.
	await client.query("select set_config('request.jwt.claim.sub', $1, false)", [
		userId,
	]);
}

/** Crea un usuario anónimo mínimo (D-020) para poder simular su sesión sin pasar por GoTrue. */
async function createAnonymousUser(admin: Client): Promise<string> {
	const id = randomUUID();
	await admin.query(
		"insert into auth.users (id, is_anonymous, role, aud) values ($1, true, 'authenticated', 'authenticated')",
		[id],
	);
	return id;
}

export type TestUser = {
	client: Client;
	userId: string;
	close: () => Promise<void>;
};

/** Una conexión nueva, autenticada como un usuario anónimo nuevo. Aísla cada test. */
export async function connectAsNewUser(admin: Client): Promise<TestUser> {
	const userId = await createAnonymousUser(admin);
	const client = new Client({ connectionString: CONNECTION_STRING });
	await client.connect();
	await actAsUser(client, userId);
	return { client, userId, close: () => client.end() };
}

export async function connectAsSuperuser(): Promise<Client> {
	const client = new Client({ connectionString: CONNECTION_STRING });
	await client.connect();
	return client;
}

export type CreatedHousehold = {
	householdId: string;
	joinCode: string;
};

export async function createHousehold(
	client: Client,
	name = "Hogar de prueba",
): Promise<CreatedHousehold> {
	const result = await client.query("select create_household($1) as result", [
		name,
	]);
	const row = result.rows[0].result as {
		household_id: string;
		join_code: string;
	};
	return { householdId: row.household_id, joinCode: row.join_code };
}

export async function joinHousehold(
	client: Client,
	joinCode: string,
): Promise<CreatedHousehold> {
	const result = await client.query("select join_household($1) as result", [
		joinCode,
	]);
	const row = result.rows[0].result as {
		joined: boolean;
		error?: string;
		household_id?: string;
		join_code?: string;
	};
	// join_household no lanza excepción por código inválido (ver el comentario en la migración):
	// solo así el intento queda registrado para el límite de fuerza bruta. La convierte en
	// excepción aquí para que los tests (y el futuro cliente) tengan un único punto de manejo de
	// error, sin tocar el mensaje ("código inválido") que ya documentan los tests.
	if (!row.joined) {
		throw new Error("join_household: código inválido");
	}
	return {
		householdId: row.household_id as string,
		joinCode: row.join_code as string,
	};
}

export type RegeneratedCode = {
	householdId: string;
	joinCode: string;
};

export async function regenerateHouseholdCode(
	client: Client,
): Promise<RegeneratedCode> {
	const result = await client.query(
		"select regenerate_household_code() as result",
	);
	const row = result.rows[0].result as {
		household_id: string;
		join_code: string;
	};
	return { householdId: row.household_id, joinCode: row.join_code };
}

export type PatchResult = { entity: string; id: string; status: string };

export async function syncPush(
	client: Client,
	patches: Patch[],
): Promise<PatchResult[]> {
	const result = await client.query("select sync_push($1::jsonb) as result", [
		JSON.stringify(patches),
	]);
	return result.rows[0].result as PatchResult[];
}

/** Da de alta un producto vía sync_push (RLS bloquea el insert directo, D-039) y devuelve su id. */
export async function createProduct(
	client: Client,
	householdId: string,
	fields: Record<string, unknown> = {},
): Promise<string> {
	const id = randomUUID();
	await syncPush(client, [
		patch("products", id, tsAt(0), {
			household_id: householdId,
			name: "Producto de prueba",
			...fields,
		}),
	]);
	return id;
}

export async function createSupermarket(
	client: Client,
	householdId: string,
	fields: Record<string, unknown> = {},
): Promise<string> {
	const id = randomUUID();
	await syncPush(client, [
		patch("supermarkets", id, tsAt(0), {
			household_id: householdId,
			name: "Supermercado de prueba",
			...fields,
		}),
	]);
	return id;
}

/** Agrega un producto a la lista (RF-009) vía sync_push y devuelve el id del list_item creado. */
export async function addToList(
	client: Client,
	householdId: string,
	productId: string,
	fields: Record<string, unknown> = {},
): Promise<string> {
	const id = randomUUID();
	await syncPush(client, [
		patch("list_items", id, tsAt(0), {
			household_id: householdId,
			product_id: productId,
			...fields,
		}),
	]);
	return id;
}

export { CONNECTION_STRING };
