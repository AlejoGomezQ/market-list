import { expect, test } from "@playwright/test";

/**
 * Copiar catálogo entre hogares (Fase D, D-049..D-053), contra Supabase local (Docker). Un hogar
 * nuevo y vacío parte del catálogo de otro al que el dispositivo ya pertenece, sin dar de alta los
 * productos a mano. `localStorage` empieza vacío (contexto propio de Playwright).
 */
test("un hogar nuevo copia el catálogo de otro y lo ve en el Catálogo", async ({
	page,
}) => {
	const ts = Date.now();
	const nameA = `Hogar A ${ts}`;
	const nameB = `Hogar B ${ts}`;
	const productName = `Lentejas ${ts}`;

	async function createHousehold(name: string) {
		await page.getByPlaceholder("Nombre del hogar").fill(name);
		await page.getByRole("button", { name: "Crear", exact: true }).click();
		await expect(page.getByRole("heading", { name })).toBeVisible();
		await page.getByRole("button", { name: "Continuar" }).click();
		await page.getByRole("button", { name: "Ahora no" }).click();
		await expect(page.getByRole("heading", { name: "Mercado" })).toBeVisible();
	}

	// Hogar A con un producto en el catálogo.
	await page.goto("/");
	await page.getByRole("button", { name: "Crear un hogar" }).click();
	await createHousehold(nameA);

	await page.getByRole("link", { name: "Catálogo", exact: true }).click();
	await page.getByRole("button", { name: "Nuevo producto" }).click();
	await page.getByLabel("Nombre").fill(productName);
	await page.getByRole("button", { name: "Guardar", exact: true }).click();
	await expect(page.getByText(productName, { exact: true })).toBeVisible();

	// Añadir hogar B desde Ajustes: queda activo y con el catálogo vacío.
	await page.getByRole("link", { name: "Ajustes" }).click();
	await page.getByRole("button", { name: "Añadir otro hogar" }).click();
	await expect(
		page.getByRole("heading", { name: "Añadir otro hogar" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Crear un hogar" }).click();
	await createHousehold(nameB);

	// Desde el estado vacío del Catálogo de B: copiar el catálogo de A.
	await page.getByRole("link", { name: "Catálogo", exact: true }).click();
	await expect(page.getByText("Añade lo que sueles comprar.")).toBeVisible();
	await page
		.getByRole("button", { name: "o copia el catálogo de otro hogar" })
		.click();

	// Un único origen posible (A): va preseleccionado.
	await expect(page.getByRole("radio", { name: nameA })).toBeChecked();
	await page.getByRole("button", { name: "Copiar catálogo" }).click();

	await expect(page.getByText("Catálogo copiado · 1 producto")).toBeVisible();
	await page.getByRole("button", { name: "Listo" }).click();

	// El producto de A aparece ya en el Catálogo de B, sin recargar.
	await expect(page.getByText(productName, { exact: true })).toBeVisible();

	// Repetir la copia es un no-op.
	await page.getByRole("link", { name: "Ajustes" }).click();
	await page
		.getByRole("button", { name: "Copiar catálogo de otro hogar" })
		.click();
	await page.getByRole("button", { name: "Copiar catálogo" }).click();
	await expect(page.getByText("Ese catálogo ya estaba copiado.")).toBeVisible();
});
