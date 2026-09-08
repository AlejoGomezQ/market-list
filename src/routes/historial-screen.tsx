import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
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
import { formatCurrency } from "@/lib/format";
import { getHouseholdLink } from "@/lib/household-link";
import { useListItemMutations } from "@/lib/mutations/list-items";
import {
	listItemsQuery,
	productsQuery,
	supermarketsQuery,
} from "@/lib/queries/household-tables";
import {
	groupPurchaseHistory,
	type PurchaseHistoryGroup,
	supermarketColorClass,
} from "@/lib/selectors";
import { cn } from "@/lib/utils";

/**
 * Historial de compras (backlog_v2 §5 y §6, D-042): las compras finalizadas, la más reciente
 * primero. Deriva de `list_items` con `groupPurchaseHistory` -- ninguna consulta nueva, son las
 * mismas tres que ya consume el Mercado.
 *
 * Lo único editable es el total de cada compra (backlog §6): corregir una cifra mal tecleada o
 * añadirla a una compra que se cerró sin ella. Toca la línea del total y se abre un drawer con el
 * campo; al guardar, un parche por cada lápida del lote (`setPurchaseTotal`), optimista y sin spinner.
 *
 * Mismo lenguaje visual que el Mercado y el Catálogo (identidad_visual §4): cada compra abre con la
 * banda a sangre completa del supermercado en su color, y debajo la fecha, los productos y el total.
 */

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

export function HistorialScreen() {
	const householdId = getHouseholdLink()?.householdId;
	const queryClient = useQueryClient();

	const { data: supermarkets = [] } = useQuery({
		...supermarketsQuery(householdId ?? ""),
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

	const listItemMutations = useListItemMutations(
		householdId ?? "",
		queryClient,
	);

	const groups = useMemo(
		() => groupPurchaseHistory(listItems, products, supermarkets),
		[listItems, products, supermarkets],
	);

	// El grupo cuyo total se está editando y el texto crudo del campo. Se captura al abrir el drawer;
	// que la lista se re-renderice mientras está abierto (otro dispositivo) no afecta -- se cierra al
	// guardar, igual que el drawer de finalizar en el Mercado.
	const [editing, setEditing] = useState<PurchaseHistoryGroup | null>(null);
	const [totalDraft, setTotalDraft] = useState("");

	function openEdit(group: PurchaseHistoryGroup) {
		setTotalDraft(group.total != null ? String(group.total) : "");
		setEditing(group);
	}

	function handleSaveTotal() {
		if (!editing) return;
		// Solo dígitos: "" -> null, que borra el total (backlog §6, es opcional).
		const digits = totalDraft.replace(/\D/g, "");
		const total = digits === "" ? null : Number(digits);
		listItemMutations.setPurchaseTotal(editing.itemIds, total);
		setEditing(null);
	}

	return (
		<section className="flex h-full flex-col">
			<header className="px-4 py-6">
				<h1 className="text-26 font-bold wdth-75">Historial</h1>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto pb-24">
				{groups.length === 0 ? (
					<div className="flex flex-col items-center px-8 pt-24 text-center">
						{/* Un estado de espera, no un lamento (identidad_visual §8). */}
						<p className="text-20 font-bold tracking-[var(--tracking-label)] text-foreground wdth-75">
							Aún no has finalizado ninguna compra.
						</p>
					</div>
				) : (
					groups.map((group) => (
						<article key={group.batchId ?? `at:${group.purchasedAt}`}>
							<h2
								className={cn(
									"flex h-11 items-center px-4 text-20 font-bold uppercase tracking-[var(--tracking-label)] wdth-75",
									group.supermarket
										? cn(
												supermarketColorClass(group.supermarket.position),
												"text-white",
											)
										: "bg-[var(--rule)] text-muted-foreground",
								)}
							>
								{group.supermarket?.name ?? "Sin asignar"}
							</h2>
							<div className="px-4 py-3">
								<p className="text-13 tabular-nums text-muted-foreground">
									{dateFormatter.format(new Date(group.purchasedAt))}
								</p>
								<ul className="mt-2">
									{group.entries.map((entry) => (
										<li
											key={entry.product.id}
											className="flex items-baseline justify-between gap-3 py-1 text-17 text-foreground"
										>
											<span>{entry.product.name}</span>
											{entry.quantity > 1 && (
												<span className="shrink-0 text-14 tabular-nums text-muted-foreground">
													x{entry.quantity}
												</span>
											)}
										</li>
									))}
								</ul>
								<button
									type="button"
									onClick={() => openEdit(group)}
									aria-label={
										group.total != null
											? "Editar el total de la compra"
											: "Añadir el total de la compra"
									}
									className="mt-2 flex min-h-[var(--min-height-tap)] w-full items-center gap-2 border-t border-border pt-2 text-left"
								>
									{group.total != null ? (
										<>
											<Pencil
												aria-hidden="true"
												className="size-4 shrink-0 text-muted-foreground"
												strokeWidth={1.75}
											/>
											<span className="text-17 font-bold tabular-nums wdth-75">
												{formatCurrency(group.total)}
											</span>
										</>
									) : (
										<>
											<Plus
												aria-hidden="true"
												className="size-4 shrink-0 text-muted-foreground"
												strokeWidth={1.75}
											/>
											<span className="text-14 text-muted-foreground">
												Añadir total
											</span>
										</>
									)}
								</button>
							</div>
						</article>
					))
				)}
			</div>

			<Drawer
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
			>
				<DrawerContent>
					{editing && (
						<>
							<DrawerHeader>
								<DrawerTitle>Total de la compra</DrawerTitle>
							</DrawerHeader>
							<DrawerBody className="gap-2">
								{/* Mismo campo que el drawer de finalizar en el Mercado: `$` fijo dentro del
								marco, teclado numérico en iOS, solo dígitos. */}
								<label
									htmlFor="historial-total"
									className="text-13 text-muted-foreground"
								>
									Total gastado
								</label>
								<div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-input px-3">
									<span
										aria-hidden="true"
										className="text-17 text-muted-foreground"
									>
										$
									</span>
									<Input
										id="historial-total"
										type="text"
										inputMode="numeric"
										autoFocus
										aria-label="Total gastado"
										value={totalDraft}
										onChange={(event) => setTotalDraft(event.target.value)}
										className="border-0 px-0 focus-visible:ring-0"
									/>
								</div>
								<p className="pt-2 text-13 text-muted-foreground">
									Déjalo vacío para quitar el total.
								</p>
							</DrawerBody>
							<DrawerFooter>
								<Button
									type="button"
									className="min-h-[var(--min-height-tap)] w-full"
									onClick={handleSaveTotal}
								>
									Guardar
								</Button>
								<Button
									type="button"
									variant="outline"
									className="min-h-[var(--min-height-tap)] w-full"
									onClick={() => setEditing(null)}
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
