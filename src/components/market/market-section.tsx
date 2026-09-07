import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useRowFlip } from "@/components/market/use-row-flip";
import { QuantityControl } from "@/components/quantity-control";
import { Button } from "@/components/ui/button";
import { splitByChecked, supermarketColorClass } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { ListItem, Product, Supermarket } from "@/schemas/domain";

interface MarketSectionProps {
	supermarket: Supermarket | null;
	entries: Array<{ item: ListItem; product: Product }>;
	collapsed: boolean;
	onToggleCollapse: () => void;
	onToggleChecked: (item: ListItem) => void;
	onQuantityChange: (item: ListItem, delta: 1 | -1) => void;
	onFinalize: (checkedIds: string[], stayingCount: number) => void;
}

/**
 * Una banda de supermercado en el Mercado (experiencia_usuario §4, D-007): cabecera plegable con
 * el contador "N de M" (pendientes de un total, no un porcentaje), filas pendientes por orden de
 * categoría (D-031, ya resuelto por `groupMarketListBySupermarket`), un separador y las marcadas
 * después (D-009), y el botón de finalizar de D-001 al pie -- desactivado sin nada marcado.
 *
 * `useRowFlip` es el único momento con movimiento de la app (identidad_visual §6): cuando una fila
 * cambia de `pending` a `checked` (o vuelve), viaja hasta su nuevo sitio en vez de saltar.
 */
export function MarketSection({
	supermarket,
	entries,
	collapsed,
	onToggleCollapse,
	onToggleChecked,
	onQuantityChange,
	onFinalize,
}: MarketSectionProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { pending, checked } = splitByChecked(entries);
	useRowFlip(containerRef, checked.map((entry) => entry.item.id).join(","));

	const [quantityEditingId, setQuantityEditingId] = useState<string | null>(
		null,
	);
	const name = supermarket?.name ?? "Sin asignar";

	function toggleQuantityEditing(id: string) {
		setQuantityEditingId((current) => (current === id ? null : id));
	}

	return (
		<div>
			<button
				type="button"
				onClick={onToggleCollapse}
				aria-expanded={!collapsed}
				className="flex min-h-[var(--min-height-tap)] w-full items-center justify-between border-b border-border px-4"
			>
				<span className="flex items-center gap-2 text-13 font-bold tracking-[var(--tracking-label)] wdth-75">
					{supermarket && (
						<span
							aria-hidden="true"
							className={cn(
								"size-2.5 rounded-full",
								supermarketColorClass(supermarket.position),
							)}
						/>
					)}
					<span className="uppercase">{name}</span>
				</span>
				<span className="flex items-center gap-2 text-13 text-muted-foreground">
					{pending.length} de {entries.length}
					<ChevronDown
						aria-hidden="true"
						strokeWidth={1.75}
						className={cn(
							"size-4 transition-transform",
							collapsed && "-rotate-90",
						)}
					/>
				</span>
			</button>

			{!collapsed && (
				<>
					<div ref={containerRef}>
						{pending.map((entry) => (
							<MarketRow
								key={entry.item.id}
								entry={entry}
								editingQuantity={quantityEditingId === entry.item.id}
								onToggleQuantityEditing={() =>
									toggleQuantityEditing(entry.item.id)
								}
								onToggleChecked={onToggleChecked}
								onQuantityChange={onQuantityChange}
							/>
						))}
						{pending.length > 0 && checked.length > 0 && (
							<div
								aria-hidden="true"
								className="border-t border-dashed border-border"
							/>
						)}
						{checked.map((entry) => (
							<MarketRow
								key={entry.item.id}
								entry={entry}
								editingQuantity={quantityEditingId === entry.item.id}
								onToggleQuantityEditing={() =>
									toggleQuantityEditing(entry.item.id)
								}
								onToggleChecked={onToggleChecked}
								onQuantityChange={onQuantityChange}
							/>
						))}
					</div>
					<div className="px-4 py-3">
						<Button
							type="button"
							disabled={checked.length === 0}
							onClick={() =>
								onFinalize(
									checked.map((entry) => entry.item.id),
									pending.length,
								)
							}
							className="min-h-[var(--min-height-tap)] w-full"
						>
							{checked.length > 0
								? `Finalizar compra · ${checked.length}`
								: "Finalizar compra"}
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

function MarketRow({
	entry,
	editingQuantity,
	onToggleQuantityEditing,
	onToggleChecked,
	onQuantityChange,
}: {
	entry: { item: ListItem; product: Product };
	editingQuantity: boolean;
	onToggleQuantityEditing: () => void;
	onToggleChecked: (item: ListItem) => void;
	onQuantityChange: (item: ListItem, delta: 1 | -1) => void;
}) {
	const { item, product } = entry;

	return (
		// <label> con un <input type="checkbox"> real (lint/a11y/useSemanticElements): el navegador
		// resuelve gratis el toque en toda la fila, el teclado y el anuncio de estado del lector de
		// pantalla, y no reenvía el click a los botones del contador de cantidad que anida (excepción
		// estándar de la activación de <label>).
		<label
			data-row-id={item.id}
			// Toda la fila marca (CLAUDE.md, experiencia_usuario §4/§8): 44px mínimo, la fila entera
			// es la zona de toque, no la casilla.
			className="flex min-h-[var(--min-height-tap)] cursor-pointer items-center gap-3 border-b border-border px-4"
		>
			<input
				type="checkbox"
				checked={item.checked}
				onChange={() => onToggleChecked(item)}
				className="sr-only"
			/>
			{/* La casilla es visual además del tachado (experiencia_usuario §8, accesibilidad): el
			estado comprado nunca se comunica solo con el color o el tachado. */}
			<span
				aria-hidden="true"
				className={cn(
					"flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] border",
					item.checked
						? "border-foreground bg-foreground text-background"
						: "border-border text-transparent",
				)}
			>
				<Check className="size-3.5" strokeWidth={2} />
			</span>
			<span
				className={cn(
					"flex-1 text-17",
					item.checked
						? "text-muted-foreground line-through"
						: "text-foreground",
				)}
			>
				{product.name}
			</span>
			{editingQuantity ? (
				<QuantityControl
					quantity={item.quantity}
					productName={product.name}
					onAdd={() => {}}
					onIncrement={() => onQuantityChange(item, 1)}
					onDecrement={() => onQuantityChange(item, -1)}
					onQuantityTap={onToggleQuantityEditing}
				/>
			) : (
				item.quantity > 1 && (
					// La cantidad solo se imprime si es mayor que 1, como cifra, no como control
					// (experiencia_usuario §4): tocarla abre el contador completo en su sitio.
					<button
						type="button"
						aria-label={`Cambiar cantidad de ${product.name}, ahora ${item.quantity}`}
						onClick={(event) => {
							event.stopPropagation();
							onToggleQuantityEditing();
						}}
						className="flex min-h-[var(--min-height-tap)] min-w-[var(--min-width-tap)] items-center justify-center text-17 tabular-nums text-foreground"
					>
						{item.quantity}
					</button>
				)
			)}
		</label>
	);
}
