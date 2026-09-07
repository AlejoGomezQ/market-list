import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
import { useSupermarketMutations } from "@/lib/mutations/supermarkets";
import {
	productsQuery,
	supermarketsQuery,
} from "@/lib/queries/household-tables";
import { nextPosition, supermarketColorClass } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { Supermarket } from "@/schemas/domain";
import { nameFieldSchema } from "@/schemas/forms";

/**
 * Alta, edición y borrado de supermercados desde Ajustes (experiencia_usuario §10: "Ajustes: ...
 * supermercados, categorías..."). Sin pantalla propia, igual que categorías (D-041): un editor
 * inline con sus propios drawers de alta/edición y confirmación de borrado, apilados sobre el
 * drawer de Ajustes (mismo patrón que `AjustesDrawer` ya usa para regenerar el código).
 */
export function SupermarketsSection({ householdId }: { householdId: string }) {
	const queryClient = useQueryClient();
	const { data: supermarkets = [] } = useQuery(supermarketsQuery(householdId));
	const { data: products = [] } = useQuery(productsQuery(householdId));
	const mutations = useSupermarketMutations(householdId, queryClient);

	const live = useMemo(
		() =>
			[...supermarkets]
				.filter((s) => s.deleted_at === null)
				.sort(
					(a, b) =>
						a.position - b.position || a.created_at.localeCompare(b.created_at),
				),
		[supermarkets],
	);

	const [editing, setEditing] = useState<Supermarket | "new" | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Supermarket | null>(null);

	function openCreate() {
		setName("");
		setError(null);
		setEditing("new");
	}

	function openEdit(supermarket: Supermarket) {
		setName(supermarket.name);
		setError(null);
		setEditing(supermarket);
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
				(p) => p.deleted_at === null && p.supermarket_id === deleting.id,
			).length
		: 0;

	return (
		<div className="flex flex-col gap-2">
			<p className="text-13 text-muted-foreground">Supermercados</p>
			<ul className="flex flex-col">
				{live.map((supermarket) => (
					<li
						key={supermarket.id}
						className="flex items-center border-b border-border"
					>
						<button
							type="button"
							onClick={() => openEdit(supermarket)}
							className="flex min-h-[var(--min-height-tap)] flex-1 items-center gap-2 text-left text-17"
						>
							<span
								aria-hidden="true"
								className={cn(
									"size-3 shrink-0 rounded-full",
									supermarketColorClass(supermarket.position),
								)}
							/>
							{supermarket.name}
						</button>
						<button
							type="button"
							aria-label={`Eliminar ${supermarket.name}`}
							onClick={() => setDeleting(supermarket)}
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
				Añadir supermercado
			</Button>

			<Drawer
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
			>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>
							{editing === "new"
								? "Nuevo supermercado"
								: "Renombrar supermercado"}
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
							placeholder="Nombre del supermercado"
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
								? `${affectedCount} producto${affectedCount === 1 ? "" : "s"} pasarán a "Sin asignar". Siguen en tu catálogo.`
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
