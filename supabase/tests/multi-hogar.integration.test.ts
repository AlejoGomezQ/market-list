// Multi-hogar (D-043..D-048, D-053) y copia de catálogo entre hogares (D-049/D-050/D-052).
// Cubre docs/plan_multi_hogar_y_copia_catalogo_v0.1.md §3.5. Requiere `supabase start`: correr con
// `pnpm test:integration`.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	addToList,
	connectAsNewUser,
	connectAsSuperuser,
	copyCatalog,
	createHousehold,
	createProduct,
	createSupermarket,
	joinHousehold,
	leaveHousehold,
	listHouseholds,
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

async function categoryId(
	client: Client,
	householdId: string,
	name: string,
): Promise<string> {
	const r = await client.query(
		"select id from categories where household_id = $1 and name = $2",
		[householdId, name],
	);
	return r.rows[0].id as string;
}

describe("regenerate_household_code — acotado a un hogar (D-048)", () => {
	it("no cambia el código de otro hogar y solo expulsa de ese hogar", async () => {
		const a = await newUser();
		const c = await newUser();
		const houseA = await createHousehold(a.client, "Casa A");
		const houseB = await createHousehold(a.client, "Casa B");
		await joinHousehold(c.client, houseA.joinCode);
		await joinHousehold(c.client, houseB.joinCode);

		await regenerateHouseholdCode(a.client, houseA.householdId);

		// A: c expulsado, solo queda a.
		const membersA = await admin.query(
			"select user_id from household_members where household_id = $1",
			[houseA.householdId],
		);
		expect(membersA.rows.map((r) => r.user_id)).toEqual([a.userId]);

		// B: intacto, y su código no cambió.
		const membersB = await admin.query(
			"select user_id from household_members where household_id = $1 order by user_id",
			[houseB.householdId],
		);
		expect(membersB.rows.map((r) => r.user_id).sort()).toEqual(
			[a.userId, c.userId].sort(),
		);
		const codeB = await admin.query(
			"select join_code from households where id = $1",
			[houseB.householdId],
		);
		expect(codeB.rows[0].join_code).toBe(houseB.joinCode);
	});
});

describe("leave_household y list_households (D-048, D-053)", () => {
	it("salir de un hogar conserva la membresía en el otro; list_households pasa de 2 a 1", async () => {
		const a = await newUser();
		const houseA = await createHousehold(a.client, "Casa A");
		const houseB = await createHousehold(a.client, "Casa B");

		expect(
			(await listHouseholds(a.client)).map((h) => h.householdId).sort(),
		).toEqual([houseA.householdId, houseB.householdId].sort());

		await leaveHousehold(a.client, houseA.householdId);

		const after = await listHouseholds(a.client);
		expect(after).toHaveLength(1);
		expect(after[0].householdId).toBe(houseB.householdId);

		const stillInB = await admin.query(
			"select 1 from household_members where household_id = $1 and user_id = $2",
			[houseB.householdId, a.userId],
		);
		expect(stillInB.rowCount).toBe(1);
	});

	it("un dispositivo unido a dos hogares aparece en ambos, ordenados por joined_at", async () => {
		const a = await newUser();
		const b = await newUser();
		const c = await newUser();
		const houseA = await createHousehold(a.client, "Casa A");
		const houseB = await createHousehold(b.client, "Casa B");

		await joinHousehold(c.client, houseA.joinCode);
		await joinHousehold(c.client, houseB.joinCode);

		const list = await listHouseholds(c.client);
		expect(list.map((h) => h.householdId)).toEqual([
			houseA.householdId,
			houseB.householdId,
		]);

		const memberships = await admin.query(
			"select household_id from household_members where user_id = $1",
			[c.userId],
		);
		expect(memberships.rows.map((r) => r.household_id).sort()).toEqual(
			[houseA.householdId, houseB.householdId].sort(),
		);
	});
});

describe("copy_catalog (D-049/D-050/D-052)", () => {
	it("copia a un destino recién creado con ids nuevos, remapeo, sin list_items ni lápidas", async () => {
		const a = await newUser();
		const source = await createHousehold(a.client, "Origen");
		const target = await createHousehold(a.client, "Destino");

		const smSource = await createSupermarket(a.client, source.householdId, {
			name: "Supermu",
		});
		const lacteosSource = await categoryId(
			a.client,
			source.householdId,
			"Lácteos",
		);
		const milk = await createProduct(a.client, source.householdId, {
			name: "Leche",
			brand: "Alpina",
			category_id: lacteosSource,
			supermarket_id: smSource,
		});
		// Item de lista y lápida en el origen: no deben viajar.
		await addToList(a.client, source.householdId, milk);
		const ghost = await createProduct(a.client, source.householdId, {
			name: "Producto fantasma",
		});
		await syncPush(a.client, [
			patch("products", ghost, tsAt(1), {
				deleted_at: new Date().toISOString(),
			}),
		]);

		const result = await copyCatalog(
			a.client,
			source.householdId,
			target.householdId,
		);
		expect(result.supermarkets_created).toBe(1);
		expect(result.categories_created).toBe(0); // las 7 de RF-020 ya emparejan
		expect(result.products_copied).toBe(1); // solo "Leche", no el fantasma

		const copied = await admin.query(
			"select id, category_id, supermarket_id from products where household_id = $1 and name = 'Leche'",
			[target.householdId],
		);
		expect(copied.rowCount).toBe(1);
		expect(copied.rows[0].id).not.toBe(milk);

		const lacteosTarget = await categoryId(
			a.client,
			target.householdId,
			"Lácteos",
		);
		expect(copied.rows[0].category_id).toBe(lacteosTarget);

		const smTarget = await admin.query(
			"select id from supermarkets where household_id = $1 and name = 'Supermu'",
			[target.householdId],
		);
		expect(copied.rows[0].supermarket_id).toBe(smTarget.rows[0].id);

		// "Lácteos" no se duplicó.
		const lacteosCount = await admin.query(
			"select count(*)::int as n from categories where household_id = $1 and name = 'Lácteos' and deleted_at is null",
			[target.householdId],
		);
		expect(lacteosCount.rows[0].n).toBe(1);

		// El fantasma no viajó.
		const ghostInTarget = await admin.query(
			"select 1 from products where household_id = $1 and name = 'Producto fantasma'",
			[target.householdId],
		);
		expect(ghostInTarget.rowCount).toBe(0);

		// Ningún list_item en el destino.
		const listItems = await admin.query(
			"select 1 from list_items where household_id = $1",
			[target.householdId],
		);
		expect(listItems.rowCount).toBe(0);
	});

	it("no duplica un producto (nombre, marca) que ya existe activo en el destino", async () => {
		const a = await newUser();
		const source = await createHousehold(a.client, "Origen");
		const target = await createHousehold(a.client, "Destino");

		await createProduct(a.client, source.householdId, {
			name: "Leche",
			brand: "Alpina",
		});
		await createProduct(a.client, target.householdId, {
			name: "leche", // distinto casing: D-006
			brand: "  Alpina ",
		});

		const result = await copyCatalog(
			a.client,
			source.householdId,
			target.householdId,
		);
		expect(result.products_copied).toBe(0);

		const count = await admin.query(
			"select count(*)::int as n from products where household_id = $1 and lower(name) = 'leche'",
			[target.householdId],
		);
		expect(count.rows[0].n).toBe(1);
	});

	it("con p_copy_supermarkets = false los productos quedan sin supermercado", async () => {
		const a = await newUser();
		const source = await createHousehold(a.client, "Origen");
		const target = await createHousehold(a.client, "Destino");

		const sm = await createSupermarket(a.client, source.householdId, {
			name: "Supermu",
		});
		await createProduct(a.client, source.householdId, {
			name: "Leche",
			supermarket_id: sm,
		});

		const result = await copyCatalog(
			a.client,
			source.householdId,
			target.householdId,
			{ copySupermarkets: false },
		);
		expect(result.supermarkets_created).toBe(0);
		expect(result.products_copied).toBe(1);

		const copied = await admin.query(
			"select supermarket_id from products where household_id = $1 and name = 'Leche'",
			[target.householdId],
		);
		expect(copied.rows[0].supermarket_id).toBeNull();
		const smInTarget = await admin.query(
			"select 1 from supermarkets where household_id = $1",
			[target.householdId],
		);
		expect(smInTarget.rowCount).toBe(0);
	});

	it("quien no es miembro del origen no puede copiar: excepción y rollback total", async () => {
		const a = await newUser();
		const b = await newUser();
		const source = await createHousehold(a.client, "Origen");
		const target = await createHousehold(b.client, "Destino");
		await createProduct(a.client, source.householdId, { name: "Leche" });

		const before = await admin.query(
			"select count(*)::int as n from products where household_id = $1",
			[target.householdId],
		);

		await expect(
			copyCatalog(b.client, source.householdId, target.householdId),
		).rejects.toThrow();

		const after = await admin.query(
			"select count(*)::int as n from products where household_id = $1",
			[target.householdId],
		);
		expect(after.rows[0].n).toBe(before.rows[0].n);
	});

	it("es idempotente: la segunda copia seguida devuelve {0,0,0}", async () => {
		const a = await newUser();
		const source = await createHousehold(a.client, "Origen");
		const target = await createHousehold(a.client, "Destino");

		await createSupermarket(a.client, source.householdId, { name: "Supermu" });
		await createProduct(a.client, source.householdId, {
			name: "Leche",
			brand: "Alpina",
		});
		await createProduct(a.client, source.householdId, { name: "Pan" });

		const first = await copyCatalog(
			a.client,
			source.householdId,
			target.householdId,
		);
		expect(first.products_copied).toBe(2);
		expect(first.supermarkets_created).toBe(1);

		const second = await copyCatalog(
			a.client,
			source.householdId,
			target.householdId,
		);
		expect(second).toEqual({
			supermarkets_created: 0,
			categories_created: 0,
			products_copied: 0,
		});
	});

	it("rechaza copiar un hogar sobre sí mismo", async () => {
		const a = await newUser();
		const house = await createHousehold(a.client, "Casa");
		await expect(
			copyCatalog(a.client, house.householdId, house.householdId),
		).rejects.toThrow();
	});

	it("rechaza un origen inexistente (no eres miembro)", async () => {
		const a = await newUser();
		const target = await createHousehold(a.client, "Destino");
		await expect(
			copyCatalog(a.client, randomUUID(), target.householdId),
		).rejects.toThrow();
	});
});
