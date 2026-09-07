import { cn } from "cn";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { findSimilarProduct } from "@/lib/selectors";
import type {
	Category,
	ListItem,
	Product,
	Supermarket,
} from "@/schemas/domain";
import { nameFieldSchema } from "@/schemas/forms";

export interface ProductDrawerState {
	mode: "create" | "edit";
	product?: Product;
}

export interface NewProductFormInput {
	name: string;
	brand: string | null;
	categoryId: string | null;
	supermarketId: string | null;
}

type EditableProductFields = Partial<
	Pick<Product, "name" | "brand" | "category_id" | "supermarket_id">
>;

interface ProductDrawerProps {
	state: ProductDrawerState | null;
	onOpenChange: (open: boolean) => void;
	supermarkets: Supermarket[];
	categories: Category[];
	products: Product[];
	activeListItem: ListItem | null;
	onCreate: (input: NewProductFormInput, andAnother: boolean) => void;
	onUpdate: (fields: EditableProductFields) => void;
	onDelete: () => void;
	onGoToSimilar: (product: Product) => void;
}

/**
 * Un solo drawer para alta y edición (experiencia_usuario §6): misma disposición de campos, con o
 * sin datos precargados. `key` en `ProductForm` fuerza un remontaje limpio al cambiar de producto
 * o de modo, así el estado del formulario no necesita un `useEffect` de sincronización.
 */
export function ProductDrawer({
	state,
	onOpenChange,
	...rest
}: ProductDrawerProps) {
	return (
		<Drawer
			open={state !== null}
			onOpenChange={(open) => {
				if (!open) onOpenChange(false);
			}}
		>
			<DrawerContent>
				{state && (
					<ProductForm
						key={state.mode === "edit" ? state.product?.id : "new"}
						mode={state.mode}
						product={state.product}
						onClose={() => onOpenChange(false)}
						{...rest}
					/>
				)}
			</DrawerContent>
		</Drawer>
	);
}

function ProductForm({
	mode,
	product,
	supermarkets,
	categories,
	products,
	activeListItem,
	onCreate,
	onUpdate,
	onDelete,
	onGoToSimilar,
	onClose,
}: Omit<ProductDrawerProps, "state" | "onOpenChange"> & {
	mode: "create" | "edit";
	product: Product | undefined;
	onClose: () => void;
}) {
	const [name, setName] = useState(product?.name ?? "");
	const [brand, setBrand] = useState(product?.brand ?? "");
	const [categoryId, setCategoryId] = useState<string | null>(
		product?.category_id ?? null,
	);
	const [supermarketId, setSupermarketId] = useState<string | null>(
		product?.supermarket_id ?? null,
	);
	const [expanded, setExpanded] = useState(
		Boolean(product?.brand || product?.category_id),
	);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const nameInputRef = useRef<HTMLInputElement>(null);

	const liveSupermarkets = supermarkets
		.filter((s) => s.deleted_at === null)
		.sort(
			(a, b) =>
				a.position - b.position || a.created_at.localeCompare(b.created_at),
		);
	const liveCategories = categories
		.filter((c) => c.deleted_at === null)
		.sort(
			(a, b) =>
				a.position - b.position || a.created_at.localeCompare(b.created_at),
		);

	const similar = findSimilarProduct(products, name, product?.id);
	const similarSupermarketName = similar
		? (supermarkets.find((s) => s.id === similar.supermarket_id)?.name ??
			"Sin asignar")
		: null;

	function resetForAnother() {
		setName("");
		setBrand("");
		setCategoryId(null);
		// El supermercado se conserva: al dar de alta varios de un tirón (D-006/experiencia_usuario
		// §6, "sesenta productos de un tirón") suele ser el mismo pasillo/tienda.
		setError(null);
		// "Guardar y otro" solo gana su sitio si el siguiente nombre se puede escribir sin volver a
		// tocar la pantalla (experiencia_usuario §6): re-enfocar es lo que hace posible dar de alta
		// varios seguidos sin un toque extra por producto.
		nameInputRef.current?.focus();
	}

	function handleSave(andAnother: boolean) {
		const parsed = nameFieldSchema.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Nombre inválido.");
			return;
		}
		const trimmedBrand = brand.trim();
		const normalizedBrand = trimmedBrand.length > 0 ? trimmedBrand : null;

		if (mode === "create") {
			onCreate(
				{
					name: parsed.data,
					brand: normalizedBrand,
					categoryId,
					supermarketId,
				},
				andAnother,
			);
			if (andAnother) {
				resetForAnother();
				return;
			}
			onClose();
			return;
		}

		if (!product) return;
		const fields: EditableProductFields = {};
		if (parsed.data !== product.name) fields.name = parsed.data;
		if (normalizedBrand !== product.brand) fields.brand = normalizedBrand;
		if (categoryId !== product.category_id) fields.category_id = categoryId;
		if (supermarketId !== product.supermarket_id)
			fields.supermarket_id = supermarketId;
		onUpdate(fields);
		onClose();
	}

	return (
		<>
			<DrawerHeader>
				<DrawerTitle>
					{mode === "create" ? "Nuevo producto" : "Editar producto"}
				</DrawerTitle>
			</DrawerHeader>
			<div className="flex flex-col gap-4 px-4 pb-6">
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="product-name"
						className="text-13 text-muted-foreground"
					>
						Nombre
					</label>
					<Input
						id="product-name"
						ref={nameInputRef}
						autoFocus
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						placeholder="Nombre del producto"
					/>
					{error && (
						<p role="alert" className="text-14 text-destructive">
							{error}
						</p>
					)}
					{!error && similar && (
						<p className="text-14 text-muted-foreground">
							¿Te refieres a {similar.name} ({similarSupermarketName})?{" "}
							<button
								type="button"
								className="underline underline-offset-2"
								onClick={() => onGoToSimilar(similar)}
							>
								Ir a ese
							</button>
						</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-13 text-muted-foreground">Supermercado</span>
					<div className="flex flex-wrap gap-2">
						{liveSupermarkets.map((supermarket) => (
							<button
								key={supermarket.id}
								type="button"
								aria-pressed={supermarketId === supermarket.id}
								onClick={() => setSupermarketId(supermarket.id)}
								className={cn(
									"min-h-[var(--min-height-tap)] rounded-[var(--radius-control)] border px-3 text-14",
									supermarketId === supermarket.id
										? "border-foreground bg-foreground text-background"
										: "border-border text-foreground",
								)}
							>
								{supermarket.name}
							</button>
						))}
						<button
							type="button"
							aria-pressed={supermarketId === null}
							aria-label="Sin asignar"
							onClick={() => setSupermarketId(null)}
							className={cn(
								"min-h-[var(--min-height-tap)] min-w-[var(--min-width-tap)] rounded-[var(--radius-control)] border px-3 text-14",
								supermarketId === null
									? "border-foreground bg-foreground text-background"
									: "border-border text-muted-foreground",
							)}
						>
							—
						</button>
					</div>
				</div>

				{!expanded ? (
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="flex min-h-[var(--min-height-tap)] items-center gap-1 self-start text-14 text-muted-foreground"
					>
						<Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
						Marca y categoría
					</button>
				) : (
					<div className="flex flex-col gap-3 border-t border-border pt-3">
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="product-brand"
								className="text-13 text-muted-foreground"
							>
								Marca
							</label>
							<Input
								id="product-brand"
								value={brand}
								onChange={(event) => setBrand(event.target.value)}
								placeholder="Marca (opcional)"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="product-category"
								className="text-13 text-muted-foreground"
							>
								Categoría
							</label>
							<select
								id="product-category"
								value={categoryId ?? ""}
								onChange={(event) => setCategoryId(event.target.value || null)}
								className="min-h-[var(--min-height-tap)] w-full rounded-[var(--radius-control)] border border-input bg-background px-3 text-17 text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								<option value="">Sin categoría</option>
								{liveCategories.map((category) => (
									<option key={category.id} value={category.id}>
										{category.name}
									</option>
								))}
							</select>
						</div>
					</div>
				)}

				<div className="flex gap-2">
					<Button
						type="button"
						className="min-h-[var(--min-height-tap)] flex-1"
						onClick={() => handleSave(false)}
					>
						Guardar
					</Button>
					{mode === "create" && (
						<Button
							type="button"
							variant="outline"
							className="min-h-[var(--min-height-tap)] flex-1"
							onClick={() => handleSave(true)}
						>
							Guardar y otro
						</Button>
					)}
				</div>

				{mode === "edit" && (
					<Button
						type="button"
						variant="destructive"
						className="min-h-[var(--min-height-tap)] w-full"
						onClick={() => setConfirmDelete(true)}
					>
						<Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
						Eliminar
					</Button>
				)}
			</div>

			<Drawer open={confirmDelete} onOpenChange={setConfirmDelete}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>¿Eliminar {product?.name}?</DrawerTitle>
						<DrawerDescription>
							{activeListItem
								? "Está en la lista de mercado. Se quitará también de ahí."
								: "Se elimina del catálogo. No se puede deshacer."}
						</DrawerDescription>
					</DrawerHeader>
					<DrawerFooter>
						<Button
							type="button"
							variant="destructive"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => {
								setConfirmDelete(false);
								onDelete();
								onClose();
							}}
						>
							Eliminar
						</Button>
						<Button
							type="button"
							variant="outline"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => setConfirmDelete(false)}
						>
							Cancelar
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>
		</>
	);
}
