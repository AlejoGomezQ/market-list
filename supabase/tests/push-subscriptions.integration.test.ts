// push_subscriptions: aislamiento por RLS directa (docs/plan_notificaciones_push_v0.1.md, Fase P1
// "Listo cuando": "los tests de integración cubren que un usuario solo ve y borra sus propias
// suscripciones"). Sin RPC (ver la migración): la política `for all using/with check (user_id =
// auth.uid())` es lo único que hay que probar aquí -- select, insert, update y delete directos.
// Requiere `supabase start` arriba: correr con `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectAsNewUser, connectAsSuperuser, type TestUser } from "./db.js";

let admin: Client;
const openUsers: TestUser[] = [];

beforeAll(async () => {
	admin = await connectAsSuperuser();
});

afterAll(async () => {
	await admin.end();
});

afterEach(async () => {
	while (openUsers.length > 0) {
		await openUsers.pop()?.close();
	}
});

async function newUser(): Promise<TestUser> {
	const user = await connectAsNewUser(admin);
	openUsers.push(user);
	return user;
}

async function insertSubscription(
	client: Client,
	userId: string,
	endpoint = `https://push.example/${randomUUID()}`,
): Promise<string> {
	await client.query(
		"insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, 'p256dh', 'auth-secret')",
		[endpoint, userId],
	);
	return endpoint;
}

describe("push_subscriptions (RLS directa, sin RPC)", () => {
	it("un usuario puede insertar y ver su propia suscripción", async () => {
		const a = await newUser();
		const endpoint = await insertSubscription(a.client, a.userId);

		const seen = await a.client.query(
			"select user_id from push_subscriptions where endpoint = $1",
			[endpoint],
		);
		expect(seen.rowCount).toBe(1);
		expect(seen.rows[0].user_id).toBe(a.userId);
	});

	it("rechaza dar de alta una fila a nombre de otro usuario (with check)", async () => {
		const a = await newUser();
		const b = await newUser();

		await expect(
			a.client.query(
				"insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, 'p', 'a')",
				[`https://push.example/${randomUUID()}`, b.userId],
			),
		).rejects.toThrow();
	});

	it("un usuario no ve las suscripciones de otro (using)", async () => {
		const a = await newUser();
		const b = await newUser();
		const endpointA = await insertSubscription(a.client, a.userId);

		const seenByB = await b.client.query(
			"select 1 from push_subscriptions where endpoint = $1",
			[endpointA],
		);
		expect(seenByB.rowCount).toBe(0);

		const seenByA = await a.client.query(
			"select 1 from push_subscriptions where endpoint = $1",
			[endpointA],
		);
		expect(seenByA.rowCount).toBe(1);
	});

	it("un usuario solo puede borrar sus propias filas", async () => {
		const a = await newUser();
		const b = await newUser();
		const endpointA = await insertSubscription(a.client, a.userId);

		const deletedByB = await b.client.query(
			"delete from push_subscriptions where endpoint = $1",
			[endpointA],
		);
		expect(deletedByB.rowCount).toBe(0);

		const stillThere = await admin.query(
			"select 1 from push_subscriptions where endpoint = $1",
			[endpointA],
		);
		expect(stillThere.rowCount).toBe(1);

		const deletedByA = await a.client.query(
			"delete from push_subscriptions where endpoint = $1",
			[endpointA],
		);
		expect(deletedByA.rowCount).toBe(1);
	});

	it("un usuario solo puede actualizar (upsert) sus propias filas", async () => {
		const a = await newUser();
		const b = await newUser();
		const endpointA = await insertSubscription(a.client, a.userId);

		const updatedByB = await b.client.query(
			"update push_subscriptions set p256dh = 'hackeado' where endpoint = $1",
			[endpointA],
		);
		expect(updatedByB.rowCount).toBe(0);

		const updatedByA = await a.client.query(
			"update push_subscriptions set p256dh = 'renovado' where endpoint = $1",
			[endpointA],
		);
		expect(updatedByA.rowCount).toBe(1);

		const stillOriginal = await admin.query(
			"select p256dh from push_subscriptions where endpoint = $1",
			[endpointA],
		);
		expect(stillOriginal.rows[0].p256dh).toBe("renovado");
	});
});

describe("push_deliveries (sin políticas: solo la Edge Function con service role, Fase P2)", () => {
	it("ningún usuario autenticado puede leer ni escribir directamente", async () => {
		const a = await newUser();

		const seen = await a.client.query("select 1 from push_deliveries");
		expect(seen.rowCount).toBe(0);

		await expect(
			a.client.query(
				"insert into push_deliveries (purchase_batch_id, household_id) values ($1, $2)",
				[randomUUID(), randomUUID()],
			),
		).rejects.toThrow();
	});
});
