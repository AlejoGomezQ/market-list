import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import {
	ProductDrawer,
	type ProductDrawerState,
} from "@/components/catalog/product-drawer";
import { Input } from "@/components/ui/input";
import { getHouseholdLink } from "@/lib/household-link";
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
 * alta). Deliberadamente NO toca la lista de mercado (fase 4): no hay control de cantidad ni de
 * "agregar", solo el catálogo -- crear, buscar, agrupar por supermercado, editar y borrar. El
 * icono de Ajustes vive aquí, no en la barra de pestañas (experiencia_usuario §3).
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
							{section.products.map((product) => (
								<button
									key={product.id}
									type="button"
									onClick={() => setDrawer({ mode: "edit", product })}
									className="flex min-h-[var(--min-height-tap)] w-full items-center justify-between border-b border-border px-4 text-left"
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
							))}
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
