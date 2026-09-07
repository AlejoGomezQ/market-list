import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarketSection } from "@/components/market/market-section";
import { SyncStatusIndicator } from "@/components/sync-status";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerBody,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { getHouseholdLink } from "@/lib/household-link";
import { useListItemMutations } from "@/lib/mutations/list-items";
import {
	categoriesQuery,
	listItemsQuery,
	productsQuery,
	supermarketsQuery,
} from "@/lib/queries/household-tables";
import {
	groupMarketListBySupermarket,
	indexActiveListItemsByProduct,
	searchProducts,
} from "@/lib/selectors";
import { useMarkListItemChecked } from "@/lib/sync/optimistic";
import { useWakeLock } from "@/lib/use-wake-lock";
import type { ListItem, Product, Supermarket } from "@/schemas/domain";

/** D-032: "un aviso al pie durante unos segundos". */
const UNDO_WINDOW_MS = 6000;

interface FinalizeConfirmState {
	supermarketName: string;
	itemIds: string[];
	staying: number;
}

/**
 * La pantalla de arranque (D-033): lista de mercado agrupada por supermercado
 * (experiencia_usuario §4, RF-013 a RF-015, RF-017). Todo el filtrado/agrupación sale de
 * `selectors.ts` sobre las cuatro consultas persistidas -- ninguna consulta nueva.
 */
export function MercadoScreen() {
	const householdId = getHouseholdLink()?.householdId;
	const queryClient = useQueryClient();

	const { data: supermarkets = [] } = useQuery({
		...supermarketsQuery(householdId ?? ""),
		enabled: Boolean(householdId),
	});
	const { data: categories = [] } = useQuery({
		...categoriesQuery(householdId ?? ""),
		enabled: Boolean(householdId),
	});
	const { data: products = [] } = useQuery({
		...productsQuery(householdId ?? ""),
		enabled: Boolean(householdId),
	});
	const { data: listItems = [] } = useQuery({
		...listItemsQuery(householdId ?? ""),
		enabled: Boolean(householdId),
	});

	// Mismo motivo que en CatalogoScreen: el router ya garantiza hogar vinculado antes de llegar
	// aquí, el `?? ""` es solo para que TypeScript vea un `string` sin romper el orden de hooks.
	const listItemMutations = useListItemMutations(
		householdId ?? "",
		queryClient,
	);
	const markChecked = useMarkListItemChecked(householdId ?? "", queryClient);

	const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
		() => new Set(),
	);
	const [searchOpen, setSearchOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [finalizeConfirm, setFinalizeConfirm] =
		useState<FinalizeConfirmState | null>(null);
	const [lastFinalized, setLastFinalized] = useState<{
		supermarketName: string;
		itemIds: string[];
	} | null>(null);
	const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Limpia el temporizador del aviso de deshacer si la pantalla se desmonta con uno pendiente.
	useEffect(() => {
		return () => {
			if (undoTimer.current) clearTimeout(undoTimer.current);
		};
	}, []);

	const sections = useMemo(
		() =>
			groupMarketListBySupermarket(
				listItems,
				products,
				supermarkets,
				categories,
			),
		[listItems, products, supermarkets, categories],
	);

	// Wake lock mientras haya pendientes (experiencia_usuario §11, Fase 7): `sections` ya viene
	// filtrada a items activos, así que basta con mirar si queda alguno sin marcar. El hook se
	// encarga solo de liberar/re-adquirir con la visibilidad; aquí solo se decide la condición de
	// negocio (pantalla de Mercado montada -- este componente -- y algo por comprar).
	const hasPending = useMemo(
		() =>
			sections.some((section) => section.entries.some((e) => !e.item.checked)),
		[sections],
	);
	useWakeLock(hasPending);

	const liveProducts = useMemo(
		() => products.filter((p) => p.deleted_at === null),
		[products],
	);
	const activeListItemByProduct = useMemo(
		() => indexActiveListItemsByProduct(listItems),
		[listItems],
	);
	const searchQuery = search.trim();
	const searchResults = useMemo(() => {
		if (!searchQuery) return [];
		return searchProducts(liveProducts, searchQuery).filter(
			(product) => !activeListItemByProduct.has(product.id),
		);
	}, [searchQuery, liveProducts, activeListItemByProduct]);

	function toggleCollapse(key: string) {
		setCollapsedSections((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	function handleAddFromSearch(product: Product) {
		listItemMutations.addToList(product);
		setSearch("");
		setSearchOpen(false);
	}

	/** D-008: crear y agregar en un solo gesto, cuando no hay coincidencias en el catálogo. */
	function handleCreateAndAdd() {
		if (!searchQuery) return;
		listItemMutations.createAndAddToList({
			name: searchQuery,
			brand: null,
			categoryId: null,
			supermarketId: null,
		});
		setSearch("");
		setSearchOpen(false);
	}

	function handleOpenFinalize(
		supermarket: Supermarket | null,
		itemIds: string[],
		staying: number,
	) {
		if (itemIds.length === 0) return;
		// D-001/arquitectura §3: se captura AQUÍ, al pulsar, el conjunto exacto de ids marcados --
		// `itemIds` ya viene de `MarketSection` con esa misma captura. Lo que el otro dispositivo
		// agregue o marque mientras este drawer de confirmación sigue abierto no puede aparecer en
		// `itemIds` porque el arreglo ya está cerrado (C-002).
		setFinalizeConfirm({
			supermarketName: supermarket?.name ?? "Sin asignar",
			itemIds,
			staying,
		});
	}

	function handleConfirmFinalize() {
		if (!finalizeConfirm) return;
		listItemMutations.finalizeSection(finalizeConfirm.itemIds);

		if (undoTimer.current) clearTimeout(undoTimer.current);
		const finalized = {
			supermarketName: finalizeConfirm.supermarketName,
			itemIds: finalizeConfirm.itemIds,
		};
		setLastFinalized(finalized);
		undoTimer.current = setTimeout(
			() => setLastFinalized(null),
			UNDO_WINDOW_MS,
		);
		setFinalizeConfirm(null);
	}

	function handleUndo() {
		if (!lastFinalized) return;
		listItemMutations.undoFinalize(lastFinalized.itemIds);
		if (undoTimer.current) clearTimeout(undoTimer.current);
		setLastFinalized(null);
	}

	return (
		<section className="flex h-full flex-col">
			<header className="px-4 py-6">
				<div className="flex items-center justify-between">
					<h1 className="text-26 font-bold wdth-75">Mercado</h1>
					<button
						type="button"
						aria-label={searchOpen ? "Cerrar buscador" : "Buscar producto"}
						onClick={() => {
							setSearchOpen((open) => !open);
							setSearch("");
						}}
						className="flex size-[var(--size-tap)] items-center justify-center text-foreground"
					>
						{searchOpen ? (
							<X aria-hidden="true" className="size-5" strokeWidth={1.75} />
						) : (
							<Search
								aria-hidden="true"
								className="size-5"
								strokeWidth={1.75}
							/>
						)}
					</button>
				</div>
				<div className="mt-1">
					<SyncStatusIndicator queryClient={queryClient} />
				</div>

				{searchOpen && (
					<div className="mt-3">
						{/* D-008: busca en el catálogo y agrega con un toque; sin resultados, ofrece
						crear y agregar en la misma acción -- cubre acordarse de algo ya en la tienda. */}
						<Input
							autoFocus
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Buscar en el catálogo…"
							aria-label="Buscar en el catálogo para agregar"
						/>
						{searchQuery && (
							<div className="mt-2 border border-border">
								{searchResults.length > 0 ? (
									searchResults.map((product) => (
										<button
											key={product.id}
											type="button"
											onClick={() => handleAddFromSearch(product)}
											className="flex min-h-[var(--min-height-tap)] w-full items-center justify-between border-b border-border px-3 text-left last:border-b-0"
										>
											<span className="text-17 text-foreground">
												{product.name}
											</span>
											<Plus
												aria-hidden="true"
												className="size-4 text-muted-foreground"
												strokeWidth={1.75}
											/>
										</button>
									))
								) : (
									<button
										type="button"
										onClick={handleCreateAndAdd}
										className="flex min-h-[var(--min-height-tap)] w-full items-center gap-2 px-3 text-left text-17 text-foreground"
									>
										<Plus
											aria-hidden="true"
											className="size-4"
											strokeWidth={1.75}
										/>
										Crear "{searchQuery}"
									</button>
								)}
							</div>
						)}
					</div>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto pb-28">
				{sections.length === 0 ? (
					<div className="flex flex-col items-center gap-3 px-8 pt-24 text-center">
						{/* Una invitación, no un lamento (identidad_visual §8): se le da presencia con
						la anchura condensada pesada del rótulo -- sin mayúsculas, reservadas a la
						señalización de supermercado (§3) -- centrada y con aire. */}
						<p className="text-20 font-bold tracking-[var(--tracking-label)] text-foreground wdth-75">
							Nada que comprar ahora mismo.
						</p>
						<Link
							to="/catalogo"
							className="text-14 text-muted-foreground underline underline-offset-4"
						>
							Ir al catálogo
						</Link>
					</div>
				) : (
					sections.map((section) => {
						const key = section.supermarket?.id ?? "sin-asignar";
						return (
							<MarketSection
								key={key}
								supermarket={section.supermarket}
								entries={section.entries}
								collapsed={collapsedSections.has(key)}
								onToggleCollapse={() => toggleCollapse(key)}
								onToggleChecked={(item: ListItem) =>
									markChecked(item, !item.checked)
								}
								onQuantityChange={(item: ListItem, delta: 1 | -1) =>
									listItemMutations.changeQuantity(item, delta)
								}
								onFinalize={(itemIds, staying) =>
									handleOpenFinalize(section.supermarket, itemIds, staying)
								}
							/>
						);
					})
				)}
			</div>

			{lastFinalized && (
				<div className="fixed inset-x-0 bottom-[calc(var(--min-height-tap)+env(safe-area-inset-bottom,0px))] flex items-center justify-between gap-3 border-t border-border bg-foreground px-4 py-3 text-background">
					<span className="text-14">
						Se finalizó la compra en {lastFinalized.supermarketName}.
					</span>
					<button
						type="button"
						onClick={handleUndo}
						className="min-h-[var(--min-height-tap)] px-2 text-14 font-bold underline underline-offset-2"
					>
						Deshacer
					</button>
				</div>
			)}

			<Drawer
				open={finalizeConfirm !== null}
				onOpenChange={(open) => {
					if (!open) setFinalizeConfirm(null);
				}}
			>
				<DrawerContent>
					{finalizeConfirm && (
						<>
							<DrawerHeader>
								<DrawerTitle>
									Finalizar compra en {finalizeConfirm.supermarketName}
								</DrawerTitle>
							</DrawerHeader>
							<DrawerBody className="gap-2">
								<div className="flex items-center justify-between text-14 text-foreground">
									<span>Saldrán de la lista</span>
									<span>{finalizeConfirm.itemIds.length} productos</span>
								</div>
								<div className="flex items-center justify-between text-14 text-foreground">
									<span>Se quedan sin comprar</span>
									<span>{finalizeConfirm.staying} productos</span>
								</div>
								<p className="pt-2 text-13 text-muted-foreground">
									Los productos siguen en tu catálogo.
								</p>
							</DrawerBody>
							<DrawerFooter>
								<Button
									type="button"
									className="min-h-[var(--min-height-tap)] w-full"
									onClick={handleConfirmFinalize}
								>
									Finalizar
								</Button>
								<Button
									type="button"
									variant="outline"
									className="min-h-[var(--min-height-tap)] w-full"
									onClick={() => setFinalizeConfirm(null)}
								>
									Cancelar
								</Button>
							</DrawerFooter>
						</>
					)}
				</DrawerContent>
			</Drawer>
		</section>
	);
}
