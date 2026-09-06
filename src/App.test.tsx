import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
	it("arranca en Mercado, la ruta raíz (D-033)", async () => {
		render(<App />);
		expect(
			await screen.findByRole("heading", { name: /mercado/i }),
		).toBeInTheDocument();
	});

	it("muestra la barra de navegación con las dos pestañas del MVP", async () => {
		render(<App />);
		await screen.findByRole("heading", { name: /mercado/i });
		expect(screen.getByRole("link", { name: /mercado/i })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /catálogo/i })).toBeInTheDocument();
	});
});
