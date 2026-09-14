import { expect, test } from "@playwright/test";

/**
 * Multi-hogar (Fase C, D-043..D-048): un dispositivo sigue varios hogares y cambia cuál está
 * activo. Contra Supabase local (Docker), nunca el proyecto remoto. `localStorage` empieza vacío
 * por el contexto propio de Playwright, así que el guardia de `router.tsx` manda a onboarding.
 */
test("añadir un segundo hogar, alternar el activo y salir del primero", async ({
	page,
}) => {
	const ts = Date.now();
	const nameA = `Hogar A ${ts}`;
	const nameB = `Hogar B ${ts}`;

	async function createHousehold(name: string) {
		await page.getByPlaceholder("Nombre del hogar").fill(name);
		await page.getByRole("button", { name: "Crear", exact: true }).click();
		await expect(page.getByRole("heading", { name })).toBeVisible();
		await page.getByRole("button", { name: "Continuar" }).click();
		await page.getByRole("button", { name: "Ahora no" }).click();
		await expect(page.getByRole("heading", { name: "Mercado" })).toBeVisible();
	}

	async function openAjustes() {
		await page.getByRole("link", { name: "Catálogo", exact: true }).click();
		await page.getByRole("link", { name: "Ajustes" }).click();
		await expect(page.getByText("Hogar activo")).toBeVisible();
	}

	// Hogar A: onboarding normal.
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "¿Empezamos?" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Crear un hogar" }).click();
	await createHousehold(nameA);

	// Ajustes -> "Añadir otro hogar" -> onboarding en modo añadir -> crear hogar B.
	await openAjustes();
	await page.getByRole("button", { name: "Añadir otro hogar" }).click();
	await expect(
		page.getByRole("heading", { name: "Añadir otro hogar" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Crear un hogar" }).click();
	await createHousehold(nameB);

	// Ahora hay dos hogares y el activo es B (el recién creado).
	await openAjustes();
	await expect(page.getByRole("button", { name: nameA })).toBeVisible();
	await expect(page.getByRole("button", { name: nameB })).toContainText(
		"Activo",
	);

	// Cambiar el activo a A: recarga y A pasa a estar marcado.
	await page.getByRole("button", { name: nameA }).click();
	await expect(page.getByRole("heading", { name: "Mercado" })).toBeVisible();
	await openAjustes();
	await expect(page.getByRole("button", { name: nameA })).toContainText(
		"Activo",
	);

	// Salir de A: quedan otros, así que limpieza selectiva y queda B.
	await page.getByRole("button", { name: "Salir de este hogar" }).click();
	await page
		.getByRole("button", { name: "Salir de este hogar" })
		.last()
		.click();
	await expect(page.getByRole("heading", { name: "Mercado" })).toBeVisible();
	await openAjustes();
	await expect(page.getByRole("button", { name: nameB })).toContainText(
		"Activo",
	);
	await expect(page.getByRole("button", { name: nameA })).toHaveCount(0);
});
