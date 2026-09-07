import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { formatCurrency } from "@/lib/format";
import { getHouseholdLink } from "@/lib/household-link";
import {
	listItemsQuery,
	productsQuery,
	supermarketsQuery,
} from "@/lib/queries/household-tables";
import { groupPurchaseHistory, supermarketColorClass } from "@/lib/selectors";
import { cn } from "@/lib/utils";

/**
 * Historial de compras (backlog_v2 §5 y §6, D-042): las compras finalizadas, la más reciente
 * primero. Deriva de `list_items` con `groupPurchaseHistory` -- ninguna consulta nueva, son las
 * mismas tres que ya consume el Mercado. Solo lectura: el total no se edita desde aquí (YAGNI).
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

	const groups = useMemo(
		() => groupPurchaseHistory(listItems, products, supermarkets),
		[listItems, products, supermarkets],
	);

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
								{group.total != null && (
									<p className="mt-2 border-t border-border pt-2 text-17 font-bold tabular-nums wdth-75">
										{formatCurrency(group.total)}
									</p>
								)}
							</div>
						</article>
					))
				)}
			</div>
		</section>
	);
}
