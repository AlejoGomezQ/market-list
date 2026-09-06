import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
	it("renderiza sin explotar", () => {
		render(<App />);
		expect(screen.getByText(/get started/i)).toBeInTheDocument();
	});
});
