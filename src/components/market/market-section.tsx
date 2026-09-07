import { Check, ChevronDown, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRowFlip } from "@/components/market/use-row-flip";
import { QuantityControl } from "@/components/quantity-control";
import { Button } from "@/components/ui/button";
import {
	formatMarketListForSharing,
	splitByChecked,
	supermarketColorClass,
} from "@/lib/selectors";
import { shareText } from "@/lib/share";
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

	// Aviso transitorio junto al botón de compartir (mismo patrón que `lastFinalized` en
	// mercado-screen: estado + setTimeout). Solo aparece cuando compartir cae en copiar o falla;
	// la hoja de compartir nativa y su cancelación no dicen nada.
	const [shareNotice, setShareNotice] = useState<string | null>(null);
	const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		return () => {
			if (shareTimer.current) clearTimeout(shareTimer.current);
		};
	}, []);

	function toggleQuantityEditing(id: string) {
		setQuantityEditingId((current) => (current === id ? null : id));
	}

	async function handleShare() {
		const result = await shareText(formatMarketListForSharing(name, entries));
		if (result === "shared" || result === "cancelled") return;
		setShareNotice(
			result === "copied" ? "Lista copiada" : "No se pudo compartir",
		);
		if (shareTimer.current) clearTimeout(shareTimer.current);
		shareTimer.current = setTimeout(() => setShareNotice(null), 2000);
	}

	return (
		<div>
			{/* La banda es el elemento memorable de la app (identidad_visual §4): franja a sangre
			completa, color sólido del supermercado, rótulo condensado pesado en blanco y contador
			a la derecha. Se queda pegada arriba mientras se recorre su sección -- el cartel del
			pasillo. "Sin asignar" va sin color (bg-rule), "es la ausencia de sitio" (§2). */}
			<button
				type="button"
				onClick={onToggleCollapse}
				aria-expanded={!collapsed}
				className={cn(
					"sticky top-0 z-10 flex min-h-[var(--min-height-tap)] w-full items-center justify-between px-4",
					supermarket
						? supermarketColorClass(supermarket.position)
						: "bg-[var(--rule)]",
				)}
			>
				<span
					className={cn(
						"text-20 font-bold uppercase tracking-[var(--tracking-label)] wdth-75",
						supermarket ? "text-white" : "text-muted-foreground",
					)}
				>
					{name}
				</span>
				<span
					className={cn(
						"flex items-center gap-2.5 text-14 tabular-nums",
						supermarket ? "text-white/85" : "text-muted-foreground",
					)}
				>
					{pending.length} de {entries.length}
					<ChevronDown
						aria-hidden="true"
						strokeWidth={1.75}
						className={cn(
							"size-[18px] transition-transform",
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
								className="my-2 border-t border-dashed border-border"
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
						{pending.length > 0 && (
							<>
								<Button
									type="button"
									variant="outline"
									onClick={handleShare}
									className="mt-2 min-h-[var(--min-height-tap)] w-full"
								>
									<Share2 aria-hidden="true" strokeWidth={1.75} />
									Compartir
								</Button>
								{shareNotice && (
									<p
										role="status"
										className="mt-2 text-center text-13 text-muted-foreground"
									>
										{shareNotice}
									</p>
								)}
							</>
						)}
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
			// Toda la fila marca (CLAUDE.md, experiencia_usuario §4/§8): la fila entera es la zona
			// de toque, no la casilla. Las filas se separan por aire, no por bordes (identidad_visual
			// §4): franjas altas (54px pendientes, 50px compradas), sin `border-b`. Ambas superan el
			// mínimo de 44px de toque.
			className={cn(
				"flex cursor-pointer items-center gap-3 px-4",
				item.checked ? "min-h-[50px]" : "min-h-[54px]",
			)}
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
