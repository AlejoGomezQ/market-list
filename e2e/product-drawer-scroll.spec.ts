import { expect, test } from "@playwright/test";

/**
 * Bug reportado por el usuario en un iPhone real: al expandir "Marca y categoría" en el drawer de
 * "Nuevo producto", el contenido crecía más allá de `max-h-[80vh]` y "Guardar" quedaba fuera de la
 * pantalla; con `touch-action: none` que vaul fija en la raíz del drawer, el dedo tampoco podía
 * hacer scroll para alcanzarlo.
 *
 * El rediseño separa el drawer en tres franjas: cabecera fija, cuerpo scrolleable (`DrawerBody`) y
 * pie fijo (`DrawerFooter`) con las acciones. La aserción correcta ahora es que, con la sección
 * expandida, "Guardar" sigue dentro del viewport sin ningún scroll, porque vive en el pie fijo.
 */
test.use({ hasTouch: true, isMobile: true });

test("con 'Marca y categoría' expandido, 'Guardar' sigue dentro del viewport sin scroll", async ({
	page,
}) => {
	const householdName = `Casa Scroll E2E ${Date.now()}`;

	await page.goto("/");
	await page.getByRole("button", { name: "Crear un hogar" }).click();
	await page.getByPlaceholder("Nombre del hogar").fill(householdName);
	await page.getByRole("button", { name: "Crear", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: householdName }),
	).toBeVisible();
	await page.getByRole("button", { name: "Continuar" }).click();

	await page.getByRole("link", { name: "Catálogo", exact: true }).click();
	await page.getByRole("button", { name: "Nuevo producto" }).click();

	const drawer = page.getByRole("dialog");
	await expect(
		drawer.getByRole("heading", { name: "Nuevo producto" }),
	).toBeVisible();

	const guardar = drawer.getByRole("button", { name: "Guardar", exact: true });
	await expect(guardar).toBeInViewport();

	// Expandir la sección opcional añade dos campos más al cuerpo; antes esto empujaba "Guardar"
	// fuera de la pantalla.
	await drawer.getByRole("button", { name: "Marca y categoría" }).click();
	await expect(drawer.getByLabel("Marca")).toBeVisible();

	// El pie es fijo: "Guardar" no se ha movido de la vista y no hace falta ningún scroll.
	await expect(guardar).toBeInViewport();
	await expect(guardar).toBeEnabled();

	// El cuerpo scrolleable es una franja propia entre cabecera y pie, no la raíz del drawer
	// (que vaul bloquea con `touch-action: none`).
	await expect(drawer.locator('[data-slot="drawer-body"]')).toBeVisible();

	// Playwright no simula el teclado de iOS, pero sí podemos comprobar el cableado: con el
	// teclado abierto iOS deja --vvh por debajo de la altura de layout. Forzamos ese valor y
	// el drawer debe acotarse a él en vez de seguir midiendo 80vh.
	await page.evaluate(
		"document.documentElement.style.setProperty('--vvh', '300px')",
	);
	await expect
		.poll(
			async () =>
				(await drawer.boundingBox())?.height ?? Number.POSITIVE_INFINITY,
		)
		.toBeLessThanOrEqual(300);
});
