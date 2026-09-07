// create_household, join_household y el aislamiento por hogar (arquitectura §5, D-014, RF-022).
// Requiere `supabase start` arriba: correr con `pnpm test:integration`.
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	connectAsNewUser,
	connectAsSuperuser,
	createHousehold,
	createProduct,
	joinHousehold,
	patch,
	regenerateHouseholdCode,
	syncPush,
	type TestUser,
	tsAt,
} from "./db.js";

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

describe("create_household", () => {
	it("crea el hogar, la membresía de quien lo crea y siembra las 7 categorías de RF-020", async () => {
		const user = await newUser();

		const { householdId, joinCode } = await createHousehold(
			user.client,
			"Casa",
		);

		expect(joinCode).toHaveLength(8);
		// D-014: alfabeto sin O/0 ni I/1.
		expect(joinCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

		const membership = await user.client.query(
			"select 1 from household_members where household_id = $1 and user_id = $2",
			[householdId, user.userId],
		);
		expect(membership.rowCount).toBe(1);

		const categories = await user.client.query(
			"select name, position from categories where household_id = $1 order by position",
			[householdId],
		);
		expect(categories.rows.map((r: { name: string }) => r.name)).toEqual([
			"Frutas y verduras",
			"Carnes",
			"Lácteos",
			"Despensa",
			"Bebidas",
			"Limpieza",
			"Higiene",
		]);
	});

	it("rechaza un nombre vacío", async () => {
		const user = await newUser();
		await expect(createHousehold(user.client, "   ")).rejects.toThrow();
	});
});

describe("join_household", () => {
	it("une al segundo usuario al mismo hogar por el código", async () => {
		const a = await newUser();
		const b = await newUser();

		const { householdId, joinCode } = await createHousehold(a.client, "Casa");
		const joined = await joinHousehold(b.client, joinCode);

		expect(joined.householdId).toBe(householdId);

		const members = await admin.query(
			"select user_id from household_members where household_id = $1",
			[householdId],
		);
		expect(members.rows.map((r) => r.user_id).sort()).toEqual(
			[a.userId, b.userId].sort(),
		);
	});

	it("es idempotente: unirse dos veces no duplica la membresía", async () => {
		const a = await newUser();
		const b = await newUser();
		const { joinCode, householdId } = await createHousehold(a.client, "Casa");

		await joinHousehold(b.client, joinCode);
		await joinHousehold(b.client, joinCode);

		const members = await admin.query(
			"select 1 from household_members where household_id = $1 and user_id = $2",
			[householdId, b.userId],
		);
		expect(members.rowCount).toBe(1);
	});

	it("rechaza un código inexistente", async () => {
		const b = await newUser();
		await expect(joinHousehold(b.client, "ZZZZZZZZ")).rejects.toThrow(
			/código inválido/,
		);
	});

	it("limita el ritmo de intentos por usuario", async () => {
		const b = await newUser();

		// El límite es 5 intentos / 5 minutos (household_functions.sql). Los primeros 5 fallan
		// por código inválido; el sexto debe fallar por límite de intentos, no por el código.
		for (let i = 0; i < 5; i++) {
			await expect(joinHousehold(b.client, "ZZZZZZZZ")).rejects.toThrow(
				/código inválido/,
			);
		}
		await expect(joinHousehold(b.client, "ZZZZZZZZ")).rejects.toThrow(
			/demasiados intentos/,
		);
	});
});

describe("regenerate_household_code", () => {
	it("cambia el código y sigue dejando entrar con el nuevo (D-014)", async () => {
		const a = await newUser();
		const { householdId, joinCode } = await createHousehold(a.client, "Casa");

		const regenerated = await regenerateHouseholdCode(a.client);

		expect(regenerated.householdId).toBe(householdId);
		expect(regenerated.joinCode).not.toBe(joinCode);
		expect(regenerated.joinCode).toHaveLength(8);

		const c = await newUser();
		const joined = await joinHousehold(c.client, regenerated.joinCode);
		expect(joined.householdId).toBe(householdId);
	});

	it("el código anterior deja de servir", async () => {
		const a = await newUser();
		const { joinCode } = await createHousehold(a.client, "Casa");
		await regenerateHouseholdCode(a.client);

		const b = await newUser();
		await expect(joinHousehold(b.client, joinCode)).rejects.toThrow(
			/código inválido/,
		);
	});

	it("expulsa a los demás dispositivos: borra su membresía (D-040)", async () => {
		const a = await newUser();
		const b = await newUser();
		const { householdId, joinCode } = await createHousehold(a.client, "Casa");
		await joinHousehold(b.client, joinCode);

		await regenerateHouseholdCode(a.client);

		const members = await admin.query(
			"select user_id from household_members where household_id = $1",
			[householdId],
		);
		expect(members.rows.map((r) => r.user_id)).toEqual([a.userId]);
	});

	it("quien regenera conserva su propia membresía", async () => {
		const a = await newUser();
		const { householdId } = await createHousehold(a.client, "Casa");

		await regenerateHouseholdCode(a.client);

		const membership = await admin.query(
			"select 1 from household_members where household_id = $1 and user_id = $2",
			[householdId, a.userId],
		);
		expect(membership.rowCount).toBe(1);
	});

	it("rechaza a quien no pertenece a ningún hogar", async () => {
		const a = await newUser();
		await expect(regenerateHouseholdCode(a.client)).rejects.toThrow();
	});
});

describe("aislamiento entre hogares (RLS)", () => {
	it("un hogar no ve las filas de otro por select directo", async () => {
		const a = await newUser();
		const b = await newUser();
		const householdA = await createHousehold(a.client, "Casa A");
		await createHousehold(b.client, "Casa B");

		const productA = await createProduct(a.client, householdA.householdId, {
			name: "Leche",
		});

		const seenByB = await b.client.query(
			"select 1 from products where id = $1",
			[productA],
		);
		expect(seenByB.rowCount).toBe(0);

		const seenByA = await a.client.query(
			"select 1 from products where id = $1",
			[productA],
		);
		expect(seenByA.rowCount).toBe(1);

		// Tampoco ve la fila del hogar ajeno ni su membresía.
		const householdRow = await b.client.query(
			"select 1 from households where id = $1",
			[householdA.householdId],
		);
		expect(householdRow.rowCount).toBe(0);
	});

	it("RLS bloquea insert/update directos incluso dentro del propio hogar (D-039)", async () => {
		const a = await newUser();
		const household = await createHousehold(a.client, "Casa");
		const productId = await createProduct(a.client, household.householdId, {
			name: "Leche",
		});

		await expect(
			a.client.query(
				"insert into products (id, household_id, name) values (gen_random_uuid(), $1, 'Intruso')",
				[household.householdId],
			),
		).rejects.toThrow();

		// Sin política de update, RLS no lanza error: el `using` de la fila afectada se evalúa a
		// falso y la sentencia simplemente no encuentra ninguna fila que tocar (D-039).
		const updateResult = await a.client.query(
			"update products set name = 'Hackeado' where id = $1",
			[productId],
		);
		expect(updateResult.rowCount).toBe(0);

		const stillOriginal = await admin.query(
			"select name from products where id = $1",
			[productId],
		);
		expect(stillOriginal.rows[0].name).toBe("Leche");
	});

	it("sync_push rechaza un parche contra el hogar de otro (no lo aplica en silencio)", async () => {
		const a = await newUser();
		const b = await newUser();
		await createHousehold(a.client, "Casa A");
		const householdB = await createHousehold(b.client, "Casa B");
		const productOfB = await createProduct(b.client, householdB.householdId, {
			name: "Original",
		});

		await expect(
			syncPush(a.client, [
				patch("products", productOfB, tsAt(0), { name: "Robado" }),
			]),
		).rejects.toThrow();

		const stillOriginal = await admin.query(
			"select name from products where id = $1",
			[productOfB],
		);
		expect(stillOriginal.rows[0].name).toBe("Original");
	});
});
