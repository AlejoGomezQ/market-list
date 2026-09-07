import { beforeEach, describe, expect, it } from "vitest";
import {
	getHouseholdLink,
	setHouseholdLink,
	updateStoredJoinCode,
} from "./household-link";

const VALID = {
	householdId: "11111111-1111-4111-8111-111111111111",
	name: "Casa",
	joinCode: "ABCDEFGH",
};

beforeEach(() => {
	localStorage.clear();
});

describe("getHouseholdLink", () => {
	it("devuelve null cuando no hay nada guardado", () => {
		expect(getHouseholdLink()).toBeNull();
	});

	it("devuelve lo guardado por setHouseholdLink", () => {
		setHouseholdLink(VALID);
		expect(getHouseholdLink()).toEqual(VALID);
	});

	it("devuelve null ante contenido corrupto, en vez de reventar (D-023 frontera Zod)", () => {
		localStorage.setItem("market-list:household", "{no es json");
		expect(getHouseholdLink()).toBeNull();
	});

	it("devuelve null ante una forma que no cumple el esquema", () => {
		localStorage.setItem(
			"market-list:household",
			JSON.stringify({ householdId: "no-es-uuid" }),
		);
		expect(getHouseholdLink()).toBeNull();
	});
});

describe("updateStoredJoinCode", () => {
	it("actualiza solo el código tras regenerate_household_code (D-040)", () => {
		setHouseholdLink(VALID);
		updateStoredJoinCode("NEWCODE1");
		expect(getHouseholdLink()).toEqual({ ...VALID, joinCode: "NEWCODE1" });
	});

	it("no hace nada si todavía no hay hogar vinculado", () => {
		updateStoredJoinCode("NEWCODE1");
		expect(getHouseholdLink()).toBeNull();
	});
});
