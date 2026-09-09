import {
	onlineManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

// vaul no monta bajo jsdom: se sustituye por divs. `open` decide si el contenido existe.
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

const copyCatalog = vi.fn();
vi.mock("@/lib/household", () => ({
	copyCatalog: (
		source: string,
		target: string,
		opts?: { copySupermarkets?: boolean; copyCategories?: boolean },
	) => copyCatalog(source, target, opts),
}));

const deltaPull = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/sync/delta-pull", () => ({
	deltaPull: (...args: unknown[]) => deltaPull(...args),
}));

const { CopyCatalogDrawer } = await import("./copy-catalog-drawer");
const { addHouseholdLink } = await import("@/lib/household-link");

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
const C = {
	householdId: "33333333-3333-4333-8333-333333333333",
	name: "Playa",
	joinCode: "QRSTUVWX",
};

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	onlineManager.setOnline(true);
});

afterEach(() => {
	onlineManager.setOnline(true);
});

function renderDrawer() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<CopyCatalogDrawer open onOpenChange={() => {}} />
		</QueryClientProvider>,
	);
}

describe("CopyCatalogDrawer", () => {
	it("sin otros hogares invita a añadir el otro hogar", () => {
		addHouseholdLink(A, { activate: true });
		renderDrawer();

		expect(
			screen.getByText("Primero añade el otro hogar del que quieres copiar."),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Añadir otro hogar" }));
		expect(navigate).toHaveBeenCalledWith({
			to: "/onboarding",
			search: { add: true },
		});
	});

	it("con varios hogares muestra el selector de origen (sin el activo)", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		addHouseholdLink(C);
		renderDrawer();

		expect(screen.getByRole("radio", { name: "Finca" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "Playa" })).toBeInTheDocument();
		expect(
			screen.queryByRole("radio", { name: "Casa" }),
		).not.toBeInTheDocument();
	});

	it("sin conexión desactiva el botón y avisa", () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		onlineManager.setOnline(false);
		renderDrawer();

		expect(
			screen.getByText("Necesitas conexión para copiar un catálogo."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Copiar catálogo" }),
		).toBeDisabled();
	});

	it("copia con los flags de las casillas y luego fuerza el delta pull", async () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		copyCatalog.mockResolvedValue({
			supermarketsCreated: 1,
			categoriesCreated: 0,
			productsCopied: 12,
		});
		renderDrawer();

		// Un solo origen posible: va preseleccionado. Se desmarca "categorías".
		fireEvent.click(screen.getByLabelText("Copiar también las categorías"));
		fireEvent.click(screen.getByRole("button", { name: "Copiar catálogo" }));

		await waitFor(() =>
			expect(copyCatalog).toHaveBeenCalledWith(B.householdId, A.householdId, {
				copySupermarkets: true,
				copyCategories: false,
			}),
		);
		expect(deltaPull).toHaveBeenCalledWith(expect.anything(), A.householdId);
		expect(
			await screen.findByText("Catálogo copiado · 12 productos"),
		).toBeInTheDocument();
	});

	it("si no se copió nada dice que ya estaba copiado", async () => {
		addHouseholdLink(A, { activate: true });
		addHouseholdLink(B);
		copyCatalog.mockResolvedValue({
			supermarketsCreated: 0,
			categoriesCreated: 0,
			productsCopied: 0,
		});
		renderDrawer();

		fireEvent.click(screen.getByRole("button", { name: "Copiar catálogo" }));

		expect(
			await screen.findByText("Ese catálogo ya estaba copiado."),
		).toBeInTheDocument();
	});
});
