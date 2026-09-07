import { describe, expect, it } from "vitest";
import {
	AA_NORMAL_TEXT_RATIO,
	contrastRatio,
	DESTRUCTIVE_DARK,
	PAPER_DARK,
	SUPERMARKET_PALETTE,
	WHITE,
} from "./contrast";

describe("contrastRatio", () => {
	it("da 21:1 entre negro y blanco (caso conocido)", () => {
		expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
	});

	it("da 1:1 para un color contra sí mismo", () => {
		expect(contrastRatio("#B3261E", "#B3261E")).toBeCloseTo(1, 5);
	});
});

describe("paleta de supermercado vs texto blanco (identidad_visual_v0.1.md §9)", () => {
	for (const [name, hex] of Object.entries(SUPERMARKET_PALETTE)) {
		it(`${name} (${hex}) cumple AA de texto normal (>= ${AA_NORMAL_TEXT_RATIO}:1)`, () => {
			expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(
				AA_NORMAL_TEXT_RATIO,
			);
		});
	}
});

describe("--destructive en modo oscuro (Fase 5, index.css)", () => {
	it("cumple AA de texto normal sobre --paper oscuro", () => {
		expect(contrastRatio(DESTRUCTIVE_DARK, PAPER_DARK)).toBeGreaterThanOrEqual(
			AA_NORMAL_TEXT_RATIO,
		);
	});
});
