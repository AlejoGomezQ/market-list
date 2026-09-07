import type { QueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerBody,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useSupermarketMutations } from "@/lib/mutations/supermarkets";
import {
	findSimilarProduct,
	nextPosition,
	supermarketColorClass,
} from "@/lib/selectors";
import { cn } from "@/lib/utils";
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
	householdId: string;
	queryClient: QueryClient;
	supermarkets: Supermarket[];
	categories: Category[];
	products: Product[];
	activeListItem: ListItem | null;
	onCreate: (input: NewProductFormInput) => void;
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
	householdId,
	queryClient,
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

	const supermarketMutations = useSupermarketMutations(
		householdId,
		queryClient,
	);
	const [newSupermarketOpen, setNewSupermarketOpen] = useState(false);
	const [newSupermarketName, setNewSupermarketName] = useState("");
	const [newSupermarketError, setNewSupermarketError] = useState<string | null>(
		null,
	);

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

	function handleSave() {
		const parsed = nameFieldSchema.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Nombre inválido.");
			return;
		}
		const trimmedBrand = brand.trim();
		const normalizedBrand = trimmedBrand.length > 0 ? trimmedBrand : null;

		if (mode === "create") {
			onCreate({
				name: parsed.data,
				brand: normalizedBrand,
				categoryId,
				supermarketId,
			});
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

	function handleCreateSupermarket() {
		const parsed = nameFieldSchema.safeParse(newSupermarketName);
		if (!parsed.success) {
			setNewSupermarketError(
				parsed.error.issues[0]?.message ?? "Nombre inválido.",
			);
			return;
		}
		const created = supermarketMutations.create(
			parsed.data,
			nextPosition(liveSupermarkets),
		);
		setSupermarketId(created.id);
		setNewSupermarketName("");
		setNewSupermarketError(null);
		setNewSupermarketOpen(false);
	}

	return (
		<>
			<DrawerHeader>
				<DrawerTitle>
					{mode === "create" ? "Nuevo producto" : "Editar producto"}
				</DrawerTitle>
			</DrawerHeader>
			<DrawerBody>
				<div className="flex flex-col gap-2">
					<label
						htmlFor="product-name"
						className="text-13 text-muted-foreground"
					>
						Nombre
					</label>
					<Input
						id="product-name"
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

				<div className="flex flex-col gap-2">
					<span className="text-13 text-muted-foreground">Supermercado</span>
					{liveSupermarkets.length === 0 && (
						<p className="text-14 text-muted-foreground">
							Aún no has añadido supermercados.
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						{liveSupermarkets.length > 0 && (
							<button
								type="button"
								aria-pressed={supermarketId === null}
								onClick={() => setSupermarketId(null)}
								className={cn(
									"min-h-[var(--min-height-tap)] rounded-[var(--radius-control)] px-[18px] text-14",
									supermarketId === null
										? "bg-accent text-foreground"
										: "text-muted-foreground",
								)}
							>
								Sin asignar
							</button>
						)}
						{liveSupermarkets.map((supermarket) => (
							<button
								key={supermarket.id}
								type="button"
								aria-pressed={supermarketId === supermarket.id}
								onClick={() => setSupermarketId(supermarket.id)}
								className={cn(
									"inline-flex min-h-[var(--min-height-tap)] items-center gap-1.5 rounded-[var(--radius-control)] border px-[18px] text-14",
									supermarketId === supermarket.id
										? "border-foreground bg-foreground text-background"
										: "border-border text-foreground",
								)}
							>
								<span
									aria-hidden="true"
									className={cn(
										"size-2.5 shrink-0 rounded-full",
										supermarketColorClass(supermarket.position),
									)}
								/>
								{supermarket.name}
							</button>
						))}
						<button
							type="button"
							onClick={() => {
								setNewSupermarketName("");
								setNewSupermarketError(null);
								setNewSupermarketOpen(true);
							}}
							className="inline-flex min-h-[var(--min-height-tap)] items-center gap-1 rounded-[var(--radius-control)] border border-border border-dashed px-[18px] text-14 text-muted-foreground"
						>
							<Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
							Nuevo supermercado
						</button>
					</div>
				</div>

				{!expanded ? (
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="flex min-h-[52px] items-center gap-2 border-y border-border text-14 text-muted-foreground"
					>
						<Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
						Marca y categoría
					</button>
				) : (
					<div className="flex flex-col gap-[22px] border-t border-border pt-3">
						<div className="flex flex-col gap-2">
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
						<div className="flex flex-col gap-2">
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
			</DrawerBody>

			<DrawerFooter>
				<Button
					type="button"
					className="min-h-[var(--min-height-tap)] w-full"
					onClick={handleSave}
				>
					Guardar
				</Button>
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
			</DrawerFooter>

			<Drawer open={newSupermarketOpen} onOpenChange={setNewSupermarketOpen}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Nuevo supermercado</DrawerTitle>
					</DrawerHeader>
					<DrawerBody className="gap-3">
						<Input
							autoFocus
							value={newSupermarketName}
							onChange={(event) => {
								setNewSupermarketName(event.target.value);
								setNewSupermarketError(null);
							}}
							placeholder="Nombre del supermercado"
						/>
						{newSupermarketError && (
							<p role="alert" className="text-14 text-destructive">
								{newSupermarketError}
							</p>
						)}
					</DrawerBody>
					<DrawerFooter>
						<Button
							type="button"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={handleCreateSupermarket}
						>
							Guardar
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

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
