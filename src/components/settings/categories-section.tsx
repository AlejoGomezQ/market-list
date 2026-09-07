import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { useCategoryMutations } from "@/lib/mutations/categories";
import { categoriesQuery, productsQuery } from "@/lib/queries/household-tables";
import { nextPosition } from "@/lib/selectors";
import type { Category } from "@/schemas/domain";
import { nameFieldSchema } from "@/schemas/forms";

/**
 * Administración de categorías desde Ajustes (D-041): alta, renombrar, borrar y reordenar la
 * lista global -- el orden que además ordena el Mercado por pasillo (D-031). Sin drag-and-drop:
 * mover una posición con un toque en flecha arriba/abajo cubre el caso real (sembradas 7, D-041
 * dice "alcance deliberadamente pequeño") sin traer una librería nueva.
 */
export function CategoriesSection({ householdId }: { householdId: string }) {
	const queryClient = useQueryClient();
	const { data: categories = [] } = useQuery(categoriesQuery(householdId));
	const { data: products = [] } = useQuery(productsQuery(householdId));
	const mutations = useCategoryMutations(householdId, queryClient);

	const live = useMemo(
		() =>
			[...categories]
				.filter((c) => c.deleted_at === null)
				.sort(
					(a, b) =>
						a.position - b.position || a.created_at.localeCompare(b.created_at),
				),
		[categories],
	);

	const [editing, setEditing] = useState<Category | "new" | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Category | null>(null);

	function openCreate() {
		setName("");
		setError(null);
		setEditing("new");
	}

	function openEdit(category: Category) {
		setName(category.name);
		setError(null);
		setEditing(category);
	}

	function save() {
		const parsed = nameFieldSchema.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Nombre inválido.");
			return;
		}
		if (editing === "new") {
			mutations.create(parsed.data, nextPosition(live));
		} else if (editing) {
			mutations.rename(editing, parsed.data);
		}
		setEditing(null);
	}

	const affectedCount = deleting
		? products.filter(
				(p) => p.deleted_at === null && p.category_id === deleting.id,
			).length
		: 0;

	return (
		<div className="flex flex-col gap-2">
			<p className="text-13 text-muted-foreground">Categorías</p>
			<ul className="flex flex-col">
				{live.map((category, index) => (
					<li
						key={category.id}
						className="flex items-center border-b border-border"
					>
						{/* Fase 5: las flechas de reordenar iban apiladas a 22px de alto cada una, por
						debajo del suelo de 44px por control (identidad_visual_v0.1.md §9). Puestas en
						fila en vez de en columna, cada una llega a 44×44 sin estirar el alto de la fila
						de categoría. */}
						<div className="flex">
							<button
								type="button"
								aria-label={`Subir ${category.name}`}
								disabled={index === 0}
								onClick={() => mutations.reorder(categories, category.id, "up")}
								className="flex min-h-[var(--min-height-tap)] min-w-[var(--min-width-tap)] items-center justify-center text-muted-foreground disabled:opacity-30"
							>
								<ChevronUp
									aria-hidden="true"
									className="size-4"
									strokeWidth={1.75}
								/>
							</button>
							<button
								type="button"
								aria-label={`Bajar ${category.name}`}
								disabled={index === live.length - 1}
								onClick={() =>
									mutations.reorder(categories, category.id, "down")
								}
								className="flex min-h-[var(--min-height-tap)] min-w-[var(--min-width-tap)] items-center justify-center text-muted-foreground disabled:opacity-30"
							>
								<ChevronDown
									aria-hidden="true"
									className="size-4"
									strokeWidth={1.75}
								/>
							</button>
						</div>
						<button
							type="button"
							onClick={() => openEdit(category)}
							className="flex min-h-[var(--min-height-tap)] flex-1 items-center text-left text-17"
						>
							{category.name}
						</button>
						<button
							type="button"
							aria-label={`Eliminar ${category.name}`}
							onClick={() => setDeleting(category)}
							className="flex min-h-[var(--min-height-tap)] min-w-[var(--min-width-tap)] items-center justify-center text-muted-foreground"
						>
							<Trash2
								aria-hidden="true"
								className="size-4"
								strokeWidth={1.75}
							/>
						</button>
					</li>
				))}
			</ul>
			<Button
				type="button"
				variant="outline"
				onClick={openCreate}
				className="min-h-[var(--min-height-tap)] self-start"
			>
				Añadir categoría
			</Button>

			<Drawer
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
			>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>
							{editing === "new" ? "Nueva categoría" : "Renombrar categoría"}
						</DrawerTitle>
					</DrawerHeader>
					<div className="flex flex-col gap-3 px-4 pb-6">
						<Input
							autoFocus
							value={name}
							onChange={(event) => {
								setName(event.target.value);
								setError(null);
							}}
							placeholder="Nombre de la categoría"
						/>
						{error && (
							<p role="alert" className="text-14 text-destructive">
								{error}
							</p>
						)}
						<Button
							type="button"
							onClick={save}
							className="min-h-[var(--min-height-tap)] w-full"
						>
							Guardar
						</Button>
					</div>
				</DrawerContent>
			</Drawer>

			<Drawer
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
			>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>¿Eliminar {deleting?.name}?</DrawerTitle>
						<DrawerDescription>
							{affectedCount > 0
								? `${affectedCount} producto${affectedCount === 1 ? "" : "s"} se quedarán sin categoría. Siguen en tu catálogo.`
								: "No tiene productos asignados."}
						</DrawerDescription>
					</DrawerHeader>
					<DrawerFooter>
						<Button
							type="button"
							variant="destructive"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => {
								if (deleting) mutations.remove(deleting, products);
								setDeleting(null);
							}}
						>
							Eliminar
						</Button>
						<Button
							type="button"
							variant="outline"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => setDeleting(null)}
						>
							Cancelar
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>
		</div>
	);
}
