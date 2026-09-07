import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import {
	ProductDrawer,
	type ProductDrawerState,
} from "@/components/catalog/product-drawer";
import { QuantityControl } from "@/components/quantity-control";
import { Input } from "@/components/ui/input";
import { getHouseholdLink } from "@/lib/household-link";
import { useListItemMutations } from "@/lib/mutations/list-items";
import { useProductMutations } from "@/lib/mutations/products";
import {
	categoriesQuery,
	listItemsQuery,
	productsQuery,
	supermarketsQuery,
} from "@/lib/queries/household-tables";
import {
	groupProductsBySupermarket,
	indexActiveListItemsByProduct,
	searchProducts,
} from "@/lib/selectors";
import type { Product } from "@/schemas/domain";

/**
 * Catálogo permanente de productos del hogar (experiencia_usuario §5, RF-019, RF-009 en cuanto al
 * alta). Cada fila lleva el control combinado de agregar/cantidad de D-034 (Fase 4): crear un
 * producto sigue sin agregarlo a la lista (RN-001), pero desde aquí sí se agrega, se sube o se
 * baja la cantidad y se quita. El icono de Ajustes vive aquí, no en la barra de pestañas
 * (experiencia_usuario §3).
 */
export function CatalogoScreen() {
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

	const [search, setSearch] = useState("");
	const [drawer, setDrawer] = useState<ProductDrawerState | null>(null);

	const liveProducts = useMemo(
		() => products.filter((p) => p.deleted_at === null),
		[products],
	);
	const filtered = useMemo(
		() => searchProducts(liveProducts, search),
		[liveProducts, search],
	);
	const sections = useMemo(
		() => groupProductsBySupermarket(filtered, supermarkets),
		[filtered, supermarkets],
	);
	const activeListItemByProduct = useMemo(
		() => indexActiveListItemsByProduct(listItems),
		[listItems],
	);

	// `householdId` viene del vínculo local del dispositivo (household-link.ts): el guardia de
	// router.tsx no deja llegar aquí sin hogar, así que el `?? ""` es solo para que TypeScript vea
	// un `string` -- el hook debe llamarse siempre en el mismo orden (reglas de hooks), nunca tras
	// una condición.
	const productMutations = useProductMutations(householdId ?? "", queryClient);
	const listItemMutations = useListItemMutations(
		householdId ?? "",
		queryClient,
	);

	function handleCreate(
		input: {
			name: string;
			brand: string | null;
			categoryId: string | null;
			supermarketId: string | null;
		},
		_andAnother: boolean,
	) {
		productMutations.create(input);
	}

	function handleUpdate(
		fields: Partial<
			Pick<Product, "name" | "brand" | "category_id" | "supermarket_id">
		>,
	) {
		if (drawer?.mode === "edit" && drawer.product) {
			productMutations.update(drawer.product, fields);
		}
	}

	function handleDelete() {
		if (drawer?.mode === "edit" && drawer.product) {
			const activeItem = activeListItemByProduct.get(drawer.product.id) ?? null;
			productMutations.remove(drawer.product, activeItem);
		}
	}

	return (
		<section className="flex h-full flex-col">
			<header className="flex items-center justify-between px-4 py-6">
				<h1 className="text-26 font-bold wdth-75">Catálogo</h1>
				<Link
					to="/catalogo/ajustes"
					aria-label="Ajustes"
					className="flex size-[var(--size-tap)] items-center justify-center text-foreground"
				>
					<Settings aria-hidden="true" className="size-5" strokeWidth={1.75} />
				</Link>
			</header>

			<div className="px-4 pb-3">
				<Input
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Buscar producto…"
					aria-label="Buscar producto"
				/>
			</div>

			<div className="flex-1 overflow-y-auto pb-24">
				{liveProducts.length === 0 ? (
					<p className="px-4 text-14 text-muted-foreground">
						Añade lo que sueles comprar.
					</p>
				) : sections.length === 0 ? (
					<p className="px-4 text-14 text-muted-foreground">
						Nada coincide con "{search}".
					</p>
				) : (
					sections.map((section) => (
						<div key={section.supermarket?.id ?? "sin-asignar"}>
							<h2 className="px-4 py-2 text-13 font-bold tracking-[var(--tracking-label)] text-muted-foreground wdth-75">
								{(section.supermarket?.name ?? "Sin asignar").toUpperCase()}
							</h2>
							{section.products.map((product) => {
								const activeItem =
									activeListItemByProduct.get(product.id) ?? null;
								return (
									<div
										key={product.id}
										className="flex min-h-[var(--min-height-tap)] items-center border-b border-border pl-4"
									>
										{/* Abrir detalle solo se hace desde el Catálogo, tocando el nombre
										(experiencia_usuario §5/§8); el control de cantidad de la derecha
										necesita su propia zona de toque (D-034), así que la fila ya no es un
										único <button>. */}
										<button
											type="button"
											onClick={() => setDrawer({ mode: "edit", product })}
											className="flex min-h-[var(--min-height-tap)] flex-1 items-center gap-2 py-2 text-left"
										>
											<span className="text-17 text-foreground">
												{product.name}
											</span>
											{product.brand && (
												<span className="text-14 text-muted-foreground">
													{product.brand}
												</span>
											)}
										</button>
										<QuantityControl
											quantity={activeItem?.quantity ?? 0}
											productName={product.name}
											onAdd={() => listItemMutations.addToList(product)}
											onIncrement={() =>
												activeItem &&
												listItemMutations.changeQuantity(activeItem, 1)
											}
											onDecrement={() =>
												activeItem &&
												listItemMutations.changeQuantity(activeItem, -1)
											}
										/>
									</div>
								);
							})}
						</div>
					))
				)}
			</div>

			<button
				type="button"
				aria-label="Nuevo producto"
				onClick={() => setDrawer({ mode: "create" })}
				className="fixed bottom-[calc(var(--min-height-tap)+env(safe-area-inset-bottom,0px)+16px)] right-4 flex size-12 items-center justify-center rounded-[var(--radius-control)] bg-primary text-primary-foreground"
			>
				<Plus aria-hidden="true" className="size-6" strokeWidth={1.75} />
			</button>

			<ProductDrawer
				state={drawer}
				onOpenChange={(open) => {
					if (!open) setDrawer(null);
				}}
				supermarkets={supermarkets}
				categories={categories}
				products={products}
				activeListItem={
					drawer?.mode === "edit" && drawer.product
						? (activeListItemByProduct.get(drawer.product.id) ?? null)
						: null
				}
				onCreate={handleCreate}
				onUpdate={handleUpdate}
				onDelete={handleDelete}
				onGoToSimilar={(product) => setDrawer({ mode: "edit", product })}
			/>

			<Outlet />
		</section>
	);
}
