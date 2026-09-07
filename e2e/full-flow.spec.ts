import { expect, test } from "@playwright/test";

/**
 * Escenario completo de Fase 7: onboarding, catálogo, mercado y compra, contra Supabase local
 * (Docker) -- nunca el proyecto remoto. Cada test arranca con un contexto de navegador propio
 * (Playwright), así que `localStorage` empieza vacío y el guardia de `router.tsx` manda siempre
 * a onboarding primero, sin necesidad de limpiar nada a mano.
 */
test("crear hogar, dar de alta un producto, agregarlo al mercado, marcarlo y finalizar la compra", async ({
	page,
}) => {
	const householdName = `Casa E2E ${Date.now()}`;
	const productName = `Leche E2E ${Date.now()}`;

	await page.goto("/");

	// Onboarding (D-014): sin hogar vinculado, la app no muestra ni Mercado ni Catálogo todavía.
	await expect(
		page.getByRole("heading", { name: "¿Empezamos?" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Crear un hogar" }).click();
	await page.getByPlaceholder("Nombre del hogar").fill(householdName);
	// `create_household` no es optimista (household.ts): esta llamada de verdad va a Supabase
	// local y espera la respuesta antes de avanzar a la pantalla "created".
	await page.getByRole("button", { name: "Crear", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: householdName }),
	).toBeVisible();
	await page.getByRole("button", { name: "Continuar" }).click();

	// Paso de onboarding solo para quien crea el hogar (f9a710a): elegir supermercados.
	// Es saltable y este escenario no los necesita (el producto queda en "Sin asignar").
	await page.getByRole("button", { name: "Ahora no" }).click();

	// D-033: Mercado es la pantalla de arranque, vacía todavía (RN, "estado de éxito").
	await expect(page.getByRole("heading", { name: "Mercado" })).toBeVisible();
	await expect(page.getByText("Nada que comprar ahora mismo.")).toBeVisible();

	// Catálogo: crear un producto (RN-001, no entra solo a la lista al crearse).
	await page.getByRole("link", { name: "Catálogo", exact: true }).click();
	await page.getByRole("button", { name: "Nuevo producto" }).click();
	await page.getByLabel("Nombre").fill(productName);
	await page.getByRole("button", { name: "Guardar", exact: true }).click();
	const catalogRow = page.getByText(productName, { exact: true });
	await expect(catalogRow).toBeVisible();

	// Agregar a la lista de mercado desde el carrito del Catálogo (D-034). Tocar el nombre
	// hace lo mismo, con otra etiqueta ("<nombre>, agregar a la lista").
	await page
		.getByRole("button", {
			name: `Agregar ${productName} a la lista`,
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("button", { name: `Quitar una unidad de ${productName}` }),
	).toBeVisible();

	// Mercado: el producto ya aparece en la lista, agrupado (D-002: sin supermercado asignado
	// cae en "Sin asignar"). Tocar la fila entera marca (CLAUDE.md, "la fila entera es la zona
	// de toque").
	await page.getByRole("link", { name: "Mercado", exact: true }).click();
	const marketRow = page.locator("label", { hasText: productName });
	await expect(marketRow).toBeVisible();
	await marketRow.click();
	await expect(marketRow.locator('input[type="checkbox"]')).toBeChecked();

	// Finalizar compra por supermercado (D-001), acotado a lo marcado, con confirmación.
	await page.getByRole("button", { name: /Finalizar compra/ }).click();
	await expect(
		page.getByRole("heading", { name: /Finalizar compra en/ }),
	).toBeVisible();
	await page.getByRole("button", { name: "Finalizar", exact: true }).click();

	// El aviso de deshacer confirma que finalizar corrió de verdad, y el item marcado sale de
	// la lista (RN-005: finalizar es posible aunque no quede nada marcado -- aquí no queda
	// nada más, así que el Mercado vuelve al estado vacío).
	await expect(page.getByText(/Se finalizó la compra en/)).toBeVisible();
	await expect(page.getByText("Nada que comprar ahora mismo.")).toBeVisible();
});
