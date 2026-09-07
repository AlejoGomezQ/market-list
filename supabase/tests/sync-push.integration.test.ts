// sync_push y la tabla de conflictos C-001..C-007 (docs/decisiones_cerradas_v0.1.md §4), cada uno
// en los dos órdenes de llegada posibles, comprobando que el estado final converge (criterio de
// "listo" de la Fase 1 en docs/plan_implementacion_v0.1.md). Requiere `supabase start`: correr con
// `pnpm test:integration`.
//
// Cada conflicto enfrenta dos parches de "usuarios" distintos, pero ambos se envían desde la misma
// sesión de un único miembro del hogar: sync_push solo comprueba pertenencia al hogar
// (is_member), no de qué dispositivo viene cada patch, así que un solo cliente autenticado basta
// para ejercer la fusión igual que si fueran dos.
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	addToList,
	connectAsNewUser,
	connectAsSuperuser,
	createHousehold,
	createProduct,
	createSupermarket,
	patch,
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

/** Un hogar fresco por test: evita que un conflicto contamine el siguiente. */
async function setup() {
	const user = await connectAsNewUser(admin);
	openUsers.push(user);
	const { householdId } = await createHousehold(user.client, "Casa de prueba");
	return { client: user.client, householdId };
}

async function getListItem(client: Client, id: string) {
	const r = await client.query(
		"select id, product_id, quantity, checked, checked_at, removed_at, removed_reason, purchase_batch_id, purchase_total from list_items where id = $1",
		[id],
	);
	return r.rows[0] as
		| {
				id: string;
				product_id: string;
				quantity: number;
				checked: boolean;
				checked_at: string | null;
				removed_at: string | null;
				removed_reason: string | null;
				purchase_batch_id: string | null;
				purchase_total: string | null;
		  }
		| undefined;
}

async function getProduct(client: Client, id: string) {
	const r = await client.query(
		"select id, name, brand, category_id, supermarket_id, deleted_at from products where id = $1",
		[id],
	);
	return r.rows[0];
}

describe("C-001 — marcar mientras se quita de la lista: gana quitarlo", () => {
	it.each([
		["marcar primero, quitar después", true],
		["quitar primero, marcar después", false],
	])("%s", async (_label, checkFirst) => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId);
		const itemId = await addToList(client, householdId, productId);

		const checkPatch = patch("list_items", itemId, tsAt(0), {
			checked: true,
			checked_at: tsAt(0),
		});
		const removePatch = patch("list_items", itemId, tsAt(1), {
			removed_at: tsAt(1),
			removed_reason: "removed",
		});

		const order = checkFirst
			? [checkPatch, removePatch]
			: [removePatch, checkPatch];
		for (const p of order) {
			await syncPush(client, [p]);
		}

		const item = await getListItem(client, itemId);
		// Lo único que la tabla de conflictos garantiza es que el item queda retirado (arquitectura
		// §4.1): `checked` puede diferir entre órdenes (si se marca cuando ya está retirado, el
		// parche se descarta), pero es irrelevante porque un item retirado no se muestra en el
		// Mercado -- no es un dato que la interfaz vaya a leer.
		expect(item?.removed_at).not.toBeNull();
		expect(item?.removed_reason).toBe("removed");
	});
});

describe("C-002 — finalizar mientras se agrega otro producto: lo agregado sobrevive", () => {
	it.each([
		["finalizar primero", true],
		["agregar primero", false],
	])("%s", async (_label, finalizeFirst) => {
		const { client, householdId } = await setup();
		const productX = await createProduct(client, householdId, { name: "Pan" });
		const itemX = await addToList(client, householdId, productX);
		const productY = await createProduct(client, householdId, {
			name: "Mantequilla",
		});
		const itemY = crypto.randomUUID();

		const finalizePatch = patch("list_items", itemX, tsAt(0), {
			removed_at: tsAt(0),
			removed_reason: "purchased",
		});
		const addPatch = patch("list_items", itemY, tsAt(1), {
			household_id: householdId,
			product_id: productY,
		});

		const order = finalizeFirst
			? [finalizePatch, addPatch]
			: [addPatch, finalizePatch];
		for (const p of order) {
			await syncPush(client, [p]);
		}

		const x = await getListItem(client, itemX);
		expect(x?.removed_at).not.toBeNull();
		expect(x?.removed_reason).toBe("purchased");

		const y = await getListItem(client, itemY);
		expect(y?.removed_at).toBeNull();
		expect(y?.product_id).toBe(productY);
	});
});

describe("C-003 — dos ediciones concurrentes del mismo producto", () => {
	it.each([
		["marca primero, categoría después", true],
		["categoría primero, marca después", false],
	])("campos distintos sobreviven los dos: %s", async (_label, brandFirst) => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId, {
			name: "Leche",
		});
		const categoryId = await createProductCategory(client, householdId);

		const brandPatch = patch("products", productId, tsAt(0), {
			brand: "Alpina",
		});
		const categoryPatch = patch("products", productId, tsAt(1), {
			category_id: categoryId,
		});

		const order = brandFirst
			? [brandPatch, categoryPatch]
			: [categoryPatch, brandPatch];
		for (const p of order) {
			await syncPush(client, [p]);
		}

		const product = await getProduct(client, productId);
		expect(product.brand).toBe("Alpina");
		expect(product.category_id).toBe(categoryId);
	});

	it.each([
		["ts_a primero", true],
		["ts_b primero", false],
	])(
		"mismo campo: gana el timestamp más nuevo sin importar el orden de llegada (%s)",
		async (_label, aFirst) => {
			const { client, householdId } = await setup();
			const productId = await createProduct(client, householdId, {
				name: "Leche original",
			});

			const patchA = patch("products", productId, tsAt(0), {
				name: "Nombre de A",
			});
			const patchB = patch("products", productId, tsAt(1_000), {
				name: "Nombre de B (más nuevo)",
			});

			const order = aFirst ? [patchA, patchB] : [patchB, patchA];
			for (const p of order) {
				await syncPush(client, [p]);
			}

			const product = await getProduct(client, productId);
			expect(product.name).toBe("Nombre de B (más nuevo)");
		},
	);
});

describe("C-004 — borrar un producto mientras se agrega a la lista: gana el borrado", () => {
	it.each([
		["borrar primero", true],
		["agregar primero", false],
	])("%s", async (_label, deleteFirst) => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId, {
			name: "Descontinuado",
		});
		const itemId = crypto.randomUUID();

		const deletePatch = patch("products", productId, tsAt(0), {
			deleted_at: tsAt(0),
		});
		const addPatch = patch("list_items", itemId, tsAt(1), {
			household_id: householdId,
			product_id: productId,
		});

		const order = deleteFirst
			? [deletePatch, addPatch]
			: [addPatch, deletePatch];
		for (const p of order) {
			await syncPush(client, [p]);
		}

		const product = await getProduct(client, productId);
		expect(product.deleted_at).not.toBeNull();

		// arquitectura §4.3: si el producto ya estaba borrado, la alta del item se descarta en el
		// servidor. Si el orden fue al revés, el item puede haberse creado antes del borrado --
		// arquitectura §4.3 delega ese caso al cliente ("regla de pintado, no de datos"): un item
		// cuyo producto está borrado no se pinta. Lo que debe converger es el estado EFECTIVO
		// (visible), no necesariamente si sobrevive una fila inerte en la base.
		const visible = await client.query(
			`select li.id from list_items li
			 join products p on p.id = li.product_id
			 where li.product_id = $1 and li.removed_at is null and p.deleted_at is null`,
			[productId],
		);
		expect(visible.rowCount).toBe(0);
	});
});

describe("C-005 — dos altas casi a la vez para el mismo producto: se funden en un activo", () => {
	it.each([
		["A primero", true],
		["B primero", false],
	])("%s", async (_label, aFirst) => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId, { name: "Pan" });
		const itemA = crypto.randomUUID();
		const itemB = crypto.randomUUID();

		const addA = patch("list_items", itemA, tsAt(0), {
			household_id: householdId,
			product_id: productId,
			quantity: 1,
		});
		const addB = patch("list_items", itemB, tsAt(1), {
			household_id: householdId,
			product_id: productId,
			quantity: 1,
		});

		const order = aFirst ? [addA, addB] : [addB, addA];
		for (const p of order) {
			await syncPush(client, [p]);
		}

		// El cliente indexa por product_id, no por id (arquitectura §3): lo único que importa es
		// que exista exactamente un activo, sin importar cuál de los dos ids "ganó".
		const active = await client.query(
			"select id from list_items where product_id = $1 and removed_at is null",
			[productId],
		);
		expect(active.rowCount).toBe(1);

		const total = await client.query(
			"select count(*)::int as n from list_items where product_id = $1",
			[productId],
		);
		expect(total.rows[0].n).toBe(1);
	});

	it("una alta concurrente que choca contra el índice único se funde en vez de fallar", async () => {
		// Simula la carrera real (C-005 "casi a la vez"): dos filas con el mismo id NO -- eso lo
		// evita el propio índice único a nivel de fila -- sino dos ids DISTINTOS que sync_push no
		// vio como "ya activo" antes de intentar el insert, forzando la rama del unique_violation.
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId, {
			name: "Huevos",
		});

		// Se inserta el primer activo directamente para no pasar por la comprobación previa de
		// sync_apply_list_item_patch, y así ejercer solo la rama de recuperación del choque.
		const existingId = crypto.randomUUID();
		await admin.query(
			"insert into list_items (id, household_id, product_id, field_updated_at) values ($1, $2, $3, '{}'::jsonb)",
			[existingId, householdId, productId],
		);

		const itemId = crypto.randomUUID();
		await syncPush(client, [
			patch("list_items", itemId, tsAt(0), {
				household_id: householdId,
				product_id: productId,
				quantity: 3,
			}),
		]);

		const active = await client.query(
			"select id, quantity from list_items where product_id = $1 and removed_at is null",
			[productId],
		);
		expect(active.rowCount).toBe(1);
		expect(active.rows[0].id).toBe(existingId);
		expect(active.rows[0].quantity).toBe(3);
	});
});

describe("C-006 — finalizar y deshacer con LWW sobre removed_at (no es lápida absorbente)", () => {
	it.each([
		["finalizar primero, deshacer después", true],
		["deshacer primero (no-op), finalizar después", false],
	])(
		"el deshacer más nuevo gana sin importar el orden: %s",
		async (_label, finalizeFirst) => {
			const { client, householdId } = await setup();
			const productId = await createProduct(client, householdId);
			const itemId = await addToList(client, householdId, productId);

			const finalizePatch = patch("list_items", itemId, tsAt(0), {
				removed_at: tsAt(0),
				removed_reason: "purchased",
			});
			const undoPatch = patch("list_items", itemId, tsAt(1_000), {
				removed_at: null,
			});

			const order = finalizeFirst
				? [finalizePatch, undoPatch]
				: [undoPatch, finalizePatch];
			for (const p of order) {
				await syncPush(client, [p]);
			}

			const item = await getListItem(client, itemId);
			expect(item?.removed_at).toBeNull();
		},
	);

	it.each([
		["finalizar primero", true],
		["finalizar después", false],
	])(
		"si finalizar es más nuevo que el deshacer, gana finalizar: %s",
		async (_label, finalizeFirst) => {
			const { client, householdId } = await setup();
			const productId = await createProduct(client, householdId);
			const itemId = await addToList(client, householdId, productId);

			// El deshacer tiene el timestamp MÁS VIEJO aquí: representa, p. ej., un dispositivo que
			// vuelve de un rato sin cobertura con una acción de deshacer que en realidad ocurrió antes
			// de que el otro finalizara.
			const undoPatch = patch("list_items", itemId, tsAt(0), {
				removed_at: null,
			});
			const finalizePatch = patch("list_items", itemId, tsAt(1_000), {
				removed_at: tsAt(1_000),
				removed_reason: "purchased",
			});

			const order = finalizeFirst
				? [finalizePatch, undoPatch]
				: [undoPatch, finalizePatch];
			for (const p of order) {
				await syncPush(client, [p]);
			}

			const item = await getListItem(client, itemId);
			expect(item?.removed_at).not.toBeNull();
			expect(item?.removed_reason).toBe("purchased");
		},
	);

	it("finalizar y deshacer como round-trip completo (D-032): el item vuelve a la lista tal cual", async () => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId, {
			name: "Café",
		});
		const itemId = await addToList(client, householdId, productId, {
			quantity: 2,
		});

		let active = await client.query(
			"select id from list_items where product_id = $1 and removed_at is null",
			[productId],
		);
		expect(active.rowCount).toBe(1);

		await syncPush(client, [
			patch("list_items", itemId, tsAt(10), {
				removed_at: tsAt(10),
				removed_reason: "purchased",
			}),
		]);
		active = await client.query(
			"select id from list_items where product_id = $1 and removed_at is null",
			[productId],
		);
		expect(active.rowCount).toBe(0);

		await syncPush(client, [
			patch("list_items", itemId, tsAt(20), { removed_at: null }),
		]);
		const item = await getListItem(client, itemId);
		expect(item?.removed_at).toBeNull();
		expect(item?.quantity).toBe(2);
		active = await client.query(
			"select id from list_items where product_id = $1 and removed_at is null",
			[productId],
		);
		expect(active.rowCount).toBe(1);
		expect(active.rows[0].id).toBe(itemId);
	});
});

describe("C-007 — borrar un supermercado mientras se le asigna un producto", () => {
	it.each([
		["borrar primero", true],
		["asignar primero", false],
	])("%s", async (_label, deleteFirst) => {
		const { client, householdId } = await setup();
		const supermarketId = await createSupermarket(client, householdId, {
			name: "D1",
		});
		const productId = await createProduct(client, householdId, {
			name: "Arroz",
		});

		const deletePatch = patch("supermarkets", supermarketId, tsAt(0), {
			deleted_at: tsAt(0),
		});
		const assignPatch = patch("products", productId, tsAt(1), {
			supermarket_id: supermarketId,
		});

		const order = deleteFirst
			? [deletePatch, assignPatch]
			: [assignPatch, deletePatch];
		for (const p of order) {
			await syncPush(client, [p]);
		}

		const supermarket = await client.query(
			"select deleted_at from supermarkets where id = $1",
			[supermarketId],
		);
		expect(supermarket.rows[0].deleted_at).not.toBeNull();

		const product = await getProduct(client, productId);
		// Regla de dato (no de pintado): el producto sí queda apuntando al supermercado borrado --
		// es la interfaz la que lo agrupa en "Sin asignar" (arquitectura §4.3, C-007).
		expect(product.supermarket_id).toBe(supermarketId);
	});
});

describe("historial de compras (backlog_v2 §5/§6, CAMINO A) — purchase_batch_id / purchase_total", () => {
	/** Finaliza `itemIds` como un lote: mismo ts, mismo batchId, total opcional. Espeja buildFinalizePurchase. */
	async function finalizeBatch(
		client: Client,
		itemIds: string[],
		ts: string,
		batchId: string,
		total?: number,
	) {
		await syncPush(
			client,
			itemIds.map((id) =>
				patch("list_items", id, ts, {
					removed_at: ts,
					removed_reason: "purchased",
					purchase_batch_id: batchId,
					...(total != null ? { purchase_total: total } : {}),
				}),
			),
		);
	}

	it("un lote de finalizar estampa las 4 columnas en todos sus items, con el mismo purchase_batch_id", async () => {
		const { client, householdId } = await setup();
		const pA = await createProduct(client, householdId, { name: "Pan" });
		const pB = await createProduct(client, householdId, { name: "Leche" });
		const itemA = await addToList(client, householdId, pA);
		const itemB = await addToList(client, householdId, pB);

		const batchId = crypto.randomUUID();
		await finalizeBatch(client, [itemA, itemB], tsAt(10), batchId, 42.5);

		for (const id of [itemA, itemB]) {
			const item = await getListItem(client, id);
			expect(item?.removed_at).not.toBeNull();
			expect(item?.removed_reason).toBe("purchased");
			expect(item?.purchase_batch_id).toBe(batchId);
			expect(Number(item?.purchase_total)).toBe(42.5);
		}
	});

	it("finalizar sin total: purchase_total queda null, purchase_batch_id se escribe igual", async () => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId);
		const itemId = await addToList(client, householdId, productId);

		const batchId = crypto.randomUUID();
		await finalizeBatch(client, [itemId], tsAt(10), batchId);

		const item = await getListItem(client, itemId);
		expect(item?.purchase_batch_id).toBe(batchId);
		expect(item?.purchase_total).toBeNull();
	});

	it("deshacer (buildUndoFinalize): purchase_batch_id y purchase_total vuelven a null", async () => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId);
		const itemId = await addToList(client, householdId, productId);

		const batchId = crypto.randomUUID();
		await finalizeBatch(client, [itemId], tsAt(10), batchId, 30);

		await syncPush(client, [
			patch("list_items", itemId, tsAt(20), {
				removed_at: null,
				purchase_batch_id: null,
				purchase_total: null,
			}),
		]);

		const item = await getListItem(client, itemId);
		expect(item?.removed_at).toBeNull();
		expect(item?.purchase_batch_id).toBeNull();
		expect(item?.purchase_total).toBeNull();
	});

	it("idempotencia (D-025): reenviar el parche de finalizar no cambia las columnas nuevas", async () => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId);
		const itemId = await addToList(client, householdId, productId);

		const batchId = crypto.randomUUID();
		// ts en el pasado: sync_push lo acota a now() del servidor, así que un ts futuro haría que el
		// reenvío ganara un v_ts mayor y volviera a aplicarse. Con un ts pasado los dos envíos usan
		// exactamente el mismo v_ts y el segundo empata -> ignored_stale (D-025).
		const ts = tsAt(-60_000);
		const finalize = patch("list_items", itemId, ts, {
			removed_at: ts,
			removed_reason: "purchased",
			purchase_batch_id: batchId,
			purchase_total: 15,
		});

		const first = await syncPush(client, [finalize]);
		expect(first[0].status).toBe("applied");
		const second = await syncPush(client, [finalize]);
		expect(second[0].status).toBe("ignored_stale");

		const item = await getListItem(client, itemId);
		expect(item?.purchase_batch_id).toBe(batchId);
		expect(Number(item?.purchase_total)).toBe(15);
	});
});

describe("idempotencia (D-025)", () => {
	it("reenviar el mismo parche no cambia nada la segunda vez", async () => {
		const { client, householdId } = await setup();
		const productId = await createProduct(client, householdId, {
			name: "Original",
		});
		const ts = tsAt(0);
		const editPatch = patch("products", productId, ts, { name: "Editado" });

		const first = await syncPush(client, [editPatch]);
		expect(first[0].status).toBe("applied");
		const second = await syncPush(client, [editPatch]);
		expect(second[0].status).toBe("ignored_stale");

		const product = await getProduct(client, productId);
		expect(product.name).toBe("Editado");
	});
});

async function createProductCategory(
	client: Client,
	householdId: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await syncPush(client, [
		patch("categories", id, tsAt(0), {
			household_id: householdId,
			name: "Congelados",
			position: 9,
		}),
	]);
	return id;
}
