import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { Pencil, Plus, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import {
	ProductDrawer,
	type ProductDrawerState,
} from "@/components/catalog/product-drawer";
import { CategoryFilterChips } from "@/components/category-filter-chips";
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
	supermarketColorClass,
} from "@/lib/selectors";
import { cn } from "@/lib/utils";
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
	const [categoryId, setCategoryId] = useState<string | null>(null);
	const [drawer, setDrawer] = useState<ProductDrawerState | null>(null);

	const liveProducts = useMemo(
		() => products.filter((p) => p.deleted_at === null),
		[products],
	);
	// Chips de filtro por categoría (§5): categorías vivas por `position`. El filtro es de
	// sesión -- `useState`, se pierde al desmontar la pantalla.
	const liveCategories = useMemo(
		() =>
			categories
				.filter((c) => c.deleted_at === null)
				.sort((a, b) => a.position - b.position),
		[categories],
	);
	// Filtro por categoría en memoria, antes de la búsqueda por texto: se combinan (categoría Y
	// texto). Sin categoría (`category_id === null`) queda fuera al elegir una concreta; visible
	// con "Todas". Ninguna consulta nueva (CLAUDE.md).
	const byCategory = useMemo(
		() =>
			categoryId === null
				? liveProducts
				: liveProducts.filter((p) => p.category_id === categoryId),
		[liveProducts, categoryId],
	);
	const filtered = useMemo(
		() => searchProducts(byCategory, search),
		[byCategory, search],
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

	function handleCreate(input: {
		name: string;
		brand: string | null;
		categoryId: string | null;
		supermarketId: string | null;
	}) {
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

			{/* Chips de categoría (§5): todo el catálogo vivo por `position`. Mismo componente,
			aspecto y comportamiento que en el Mercado. */}
			{liveCategories.length > 0 && (
				<CategoryFilterChips
					categories={liveCategories}
					value={categoryId}
					onChange={setCategoryId}
				/>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto pb-24">
				{liveProducts.length === 0 ? (
					<p className="px-8 pt-16 text-center text-20 font-bold text-foreground wdth-75">
						Añade lo que sueles comprar.
					</p>
				) : sections.length === 0 ? (
					<p className="px-4 pt-4 text-14 text-muted-foreground">
						{search.trim()
							? `Nada coincide con "${search}".`
							: "Nada en esta categoría."}
					</p>
				) : (
					sections.map((section) => (
						<div key={section.supermarket?.id ?? "sin-asignar"}>
							{/* Banda de supermercado: el elemento memorable de la app (identidad_visual §4).
							Sangre completa, color sólido del supermercado con el rótulo en blanco
							condensado pesado, y pegada arriba al desplazar -- el cartel del pasillo.
							"Sin asignar" no tiene color: gris `--rule`, que es la ausencia de sitio
							(§2). En el Catálogo la banda es solo rótulo: no se pliega ni lleva cuenta. */}
							<h2
								className={cn(
									"sticky top-0 z-10 flex h-11 items-center px-4 text-20 font-bold uppercase tracking-[var(--tracking-label)] wdth-75",
									section.supermarket
										? cn(
												supermarketColorClass(section.supermarket.position),
												"text-white",
											)
										: "bg-border text-muted-foreground",
								)}
							>
								{section.supermarket?.name ?? "Sin asignar"}
							</h2>
							{section.products.map((product) => {
								const activeItem =
									activeListItemByProduct.get(product.id) ?? null;
								return (
									<div
										key={product.id}
										className="flex min-h-[54px] items-center"
									>
										{/* Fila coherente con el Mercado (donde tocar la fila marca): tocar el
										nombre agrega a la lista, la misma acción que el carrito. Editar sale a
										un lápiz a la izquierda -- atenuado para que no compita con el nombre
										(identidad_visual §1) -- y el control de cantidad de la derecha
										conserva su propia zona de toque (D-034). */}
										<button
											type="button"
											aria-label={`Editar ${product.name}`}
											onClick={() => setDrawer({ mode: "edit", product })}
											className="flex size-[var(--size-tap)] shrink-0 items-center justify-center text-muted-foreground"
										>
											<Pencil
												aria-hidden="true"
												className="size-4"
												strokeWidth={1.75}
											/>
										</button>
										{/* Si el producto ya está en la lista, el nombre es texto plano: quitarlo
										con un toque accidental perdería la cantidad ya puesta, y el − N + de la
										derecha maneja todo desde ahí. "En la lista" se lee por peso y tinta, no
										por color: el color pertenece solo a los supermercados
										(identidad_visual §2, D-036). */}
										{activeItem ? (
											<span className="flex min-h-[var(--min-height-tap)] flex-1 items-center gap-2 py-2 text-17 font-medium text-foreground">
												{product.name}
												{product.brand && (
													<span className="text-14 font-normal text-muted-foreground">
														{product.brand}
													</span>
												)}
											</span>
										) : (
											<button
												type="button"
												// Etiqueta distinta de la del carrito ("Agregar X a la lista"), que
												// hace la misma acción pero es un objetivo de toque aparte: dos
												// botones con el mismo nombre accesible en una fila confunden al
												// lector de pantalla.
												aria-label={`${product.name}, agregar a la lista`}
												onClick={() => listItemMutations.addToList(product)}
												className="flex min-h-[var(--min-height-tap)] flex-1 items-center gap-2 py-2 text-left text-17 text-muted-foreground"
											>
												{product.name}
												{product.brand && (
													<span className="text-14 text-muted-foreground">
														{product.brand}
													</span>
												)}
											</button>
										)}
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
				className="fixed bottom-[calc(var(--min-height-tap)+env(safe-area-inset-bottom,0px)+16px)] right-4 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground"
			>
				<Plus aria-hidden="true" className="size-[26px]" strokeWidth={1.75} />
			</button>

			<ProductDrawer
				state={drawer}
				onOpenChange={(open) => {
					if (!open) setDrawer(null);
				}}
				householdId={householdId ?? ""}
				queryClient={queryClient}
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
