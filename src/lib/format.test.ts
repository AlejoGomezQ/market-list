import { describe, expect, it } from "vitest";
import { formatCurrency } from "./format";

describe("formatCurrency", () => {
	it("prefixes a fixed $ and groups thousands with no decimals (es-CO)", () => {
		expect(formatCurrency(85400)).toBe("$85.400");
	});

	it("handles zero", () => {
		expect(formatCurrency(0)).toBe("$0");
	});

	it("rounds decimals away", () => {
		expect(formatCurrency(1234.56)).toBe("$1.235");
	});
});
