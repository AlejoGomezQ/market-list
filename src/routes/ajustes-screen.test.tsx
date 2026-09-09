import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

// vaul (Drawer) no monta bien bajo jsdom y no es lo que se prueba aquí: se sustituye por divs. Los
// drawers anidados respetan `open` para que el contenido del pie solo exista cuando toca.
vi.mock("@/components/ui/drawer", () => {
	const Pass = ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	);
	return {
		Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
			open === undefined || open ? <div>{children}</div> : null,
		DrawerContent: Pass,
		DrawerHeader: Pass,
		DrawerBody: Pass,
		DrawerFooter: Pass,
		DrawerTitle: Pass,
		DrawerDescription: Pass,
	};
});

// Secciones de supermercados/categorías: usan `useQuery` contra Supabase (no configurado en test).
vi.mock("@/components/settings/supermarkets-section", () => ({
	SupermarketsSection: () => null,
}));
vi.mock("@/components/settings/categories-section", () => ({
	CategoriesSection: () => null,
}));

const listHouseholds = vi.fn();
const leaveHousehold = vi.fn();
const regenerateHouseholdCode = vi.fn();
vi.mock("@/lib/household", () => ({
	listHouseholds: () => listHouseholds(),
	leaveHousehold: (id?: string) => leaveHousehold(id),
	regenerateHouseholdCode: (id?: string) => regenerateHouseholdCode(id),
}));

const clearHouseholdSyncState = vi.fn().mockResolvedValue(undefined);
const clearPersistedSyncState = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/query-client", () => ({
	clearHouseholdSyncState: (id: string) => clearHouseholdSyncState(id),
	clearPersistedSyncState: () => clearPersistedSyncState(),
}));

const { AjustesDrawer } = await import("./ajustes-screen");
const {
	addHouseholdLink,
	getActiveHouseholdId,
	getHouseholdLink,
	getHouseholdLinks,
} = await import("@/lib/household-link");

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

const assign = vi.fn();

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	Object.defineProperty(window, "location", {
		configurable: true,
		value: { assign, href: "http://localhost/", pathname: "/" },
	});
});

function renderDrawer() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<AjustesDrawer />
		</QueryClientProvider>,
	);
}

describe("Hogar activo -- cambiar de activo", () => {
	it("tocar otro hogar fija el activo y recarga en Mercado", async () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		listHouseholds.mockResolvedValue([A, B]);
		renderDrawer();

		fireEvent.click(screen.getByRole("button", { name: /Finca/ }));

		await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
		expect(getActiveHouseholdId()).toBe(B.householdId);
	});
});

describe("Hogar activo -- reconciliación con list_households()", () => {
	it("poda un hogar que el servidor ya no devuelve y avisa en frase", async () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		listHouseholds.mockResolvedValue([A]); // B: te expulsaron

		renderDrawer();

		await waitFor(() =>
			expect(clearHouseholdSyncState).toHaveBeenCalledWith(B.householdId),
		);
		expect(getHouseholdLinks()).toEqual([A]);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Ya no perteneces a «Finca».",
		);
		// B no era el activo -> no recarga
		expect(assign).not.toHaveBeenCalled();
	});

	it("si la RPC falla, se queda con el vínculo local sin avisar", async () => {
		addHouseholdLink(A, { activate: true });
		listHouseholds.mockRejectedValue(new Error("sin red"));

		renderDrawer();

		await waitFor(() => expect(listHouseholds).toHaveBeenCalled());
		expect(getHouseholdLinks()).toEqual([A]);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
});

describe("Salir de este hogar (D-047)", () => {
	function openLeaveAndConfirm() {
		fireEvent.click(
			screen.getByRole("button", { name: "Salir de este hogar" }),
		);
		const buttons = screen.getAllByRole("button", {
			name: "Salir de este hogar",
		});
		fireEvent.click(buttons[buttons.length - 1]);
	}

	it("con dos hogares hace limpieza selectiva, no la global", async () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		listHouseholds.mockResolvedValue([A, B]);
		leaveHousehold.mockResolvedValue(undefined);
		renderDrawer();

		openLeaveAndConfirm();

		await waitFor(() =>
			expect(clearHouseholdSyncState).toHaveBeenCalledWith(A.householdId),
		);
		expect(clearPersistedSyncState).not.toHaveBeenCalled();
		expect(getHouseholdLinks()).toEqual([B]);
		expect(assign).toHaveBeenCalledWith("/");
	});

	it("con un solo hogar hace la limpieza global y borra el vínculo", async () => {
		addHouseholdLink(A, { activate: true });
		listHouseholds.mockResolvedValue([A]);
		leaveHousehold.mockResolvedValue(undefined);
		renderDrawer();

		openLeaveAndConfirm();

		await waitFor(() => expect(clearPersistedSyncState).toHaveBeenCalled());
		expect(clearHouseholdSyncState).not.toHaveBeenCalled();
		expect(getHouseholdLink()).toBeNull();
		expect(assign).toHaveBeenCalledWith("/");
	});
});
