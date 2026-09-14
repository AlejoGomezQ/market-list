import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addHouseholdLink,
	getActiveHouseholdId,
	getHouseholdLink,
	getHouseholdLinks,
	removeHouseholdLink,
	setActiveHousehold,
	setHouseholdLink,
	updateStoredJoinCode,
} from "./household-link";

const STORAGE_KEY = "market-list:household";

const A = {
	householdId: "11111111-1111-4111-8111-111111111111",
	name: "Casa",
	joinCode: "ABCDEFGH",
};
const B = {
	householdId: "22222222-2222-4222-8222-222222222222",
	name: "Finca",
	joinCode: "IJKLMNOP",
};

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

function stored() {
	return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
}

describe("migración del formato viejo (un solo hogar) al nuevo", () => {
	it("envuelve el objeto viejo en { households: [viejo], activeId } y reescribe el storage", () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(A));

		expect(getHouseholdLink()).toEqual(A);
		expect(getHouseholdLinks()).toEqual([A]);
		expect(stored()).toEqual({ households: [A], activeId: A.householdId });
	});
});

describe("getHouseholdLink / getActiveHouseholdId", () => {
	it("null cuando no hay nada guardado", () => {
		expect(getHouseholdLink()).toBeNull();
		expect(getActiveHouseholdId()).toBeNull();
		expect(getHouseholdLinks()).toEqual([]);
	});

	it("devuelve el vínculo activo, no el primero de la lista", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B, { activate: true });

		expect(getHouseholdLink()).toEqual(B);
		expect(getActiveHouseholdId()).toBe(B.householdId);
	});

	it("si activeId no está en households, devuelve el primero y corrige el storage", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ households: [A, B], activeId: "no-existe" }),
		);

		expect(getHouseholdLink()).toEqual(A);
		expect(stored().activeId).toBe(A.householdId);
	});

	it("contenido corrupto -> sin hogares (igual que el null de siempre)", () => {
		localStorage.setItem(STORAGE_KEY, "{no es json");
		expect(getHouseholdLink()).toBeNull();
		expect(getHouseholdLinks()).toEqual([]);
	});

	it("forma que no cumple ninguno de los dos esquemas -> sin hogares", () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ householdId: "no-uuid" }),
		);
		expect(getHouseholdLink()).toBeNull();
	});
});

describe("addHouseholdLink / setHouseholdLink", () => {
	it("añade un hogar nuevo sin cambiar el activo salvo que sea el primero", () => {
		addHouseholdLink(A); // primero -> activo
		expect(getActiveHouseholdId()).toBe(A.householdId);

		addHouseholdLink(B); // segundo, sin activate -> no cambia el activo
		expect(getActiveHouseholdId()).toBe(A.householdId);
		expect(getHouseholdLinks()).toEqual([A, B]);
	});

	it("actualiza en sitio el hogar que ya existe (nombre/código nuevos), sin duplicar", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);

		const renamed = { ...A, name: "Casa nueva", joinCode: "ZZZZZZZZ" };
		addHouseholdLink(renamed);

		expect(getHouseholdLinks()).toEqual([renamed, B]);
		expect(getActiveHouseholdId()).toBe(A.householdId);
	});

	it("setHouseholdLink añade y deja activo (onboarding: crear/unirse)", () => {
		addHouseholdLink(A, { activate: true });
		setHouseholdLink(B);
		expect(getActiveHouseholdId()).toBe(B.householdId);
	});
});

describe("setActiveHousehold", () => {
	it("cambia el activo a otro hogar de la lista", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);

		setActiveHousehold(B.householdId);
		expect(getActiveHouseholdId()).toBe(B.householdId);
	});

	it("no-op con aviso si el id no está en la lista", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		addHouseholdLink(A, { activate: true });

		setActiveHousehold(B.householdId);

		expect(getActiveHouseholdId()).toBe(A.householdId);
		expect(warn).toHaveBeenCalled();
	});
});

describe("removeHouseholdLink", () => {
	it("quitar el activo promueve el primero que quede", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		setActiveHousehold(B.householdId);

		removeHouseholdLink(B.householdId);

		expect(getHouseholdLinks()).toEqual([A]);
		expect(getActiveHouseholdId()).toBe(A.householdId);
	});

	it("quitar uno no activo deja el activo intacto", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);

		removeHouseholdLink(B.householdId);

		expect(getHouseholdLinks()).toEqual([A]);
		expect(getActiveHouseholdId()).toBe(A.householdId);
	});

	it("quitar el último deja el storage en estado 'sin hogares'", () => {
		addHouseholdLink(A, { activate: true });

		removeHouseholdLink(A.householdId);

		expect(getHouseholdLink()).toBeNull();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});

describe("updateStoredJoinCode", () => {
	it("por defecto actualiza el código del hogar activo", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);

		updateStoredJoinCode("NEWCODE1");

		expect(getHouseholdLinks()).toEqual([{ ...A, joinCode: "NEWCODE1" }, B]);
	});

	it("con householdId actualiza el código de ese hogar concreto", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);

		updateStoredJoinCode("NEWCODE2", B.householdId);

		expect(getHouseholdLinks()).toEqual([A, { ...B, joinCode: "NEWCODE2" }]);
	});

	it("no hace nada si no hay hogar vinculado", () => {
		updateStoredJoinCode("NEWCODE1");
		expect(getHouseholdLink()).toBeNull();
	});
});
