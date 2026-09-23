import { cn } from "@/lib/utils";
import type { Category } from "@/schemas/domain";

interface CategoryFilterChipsProps {
	/** Qué categorías se ofrecen. El llamador decide: todo el catálogo vivo en el Catálogo, solo
	 * las presentes en la lista en el Mercado. Se pintan en el orden recibido. */
	categories: Category[];
	value: string | null;
	onChange: (categoryId: string | null) => void;
}

/**
 * Fila de chips acromáticos para filtrar por categoría (identidad_visual §2/§5): scroll horizontal
 * sin barra visible, área de toque de 44px, chip activo por tinta y fondo neutro -- nunca por color
 * de supermercado (D-036). Single-select; tocar el chip activo, o "Todas", vuelve a todo. El estado
 * lo mantiene el llamador y es de sesión (no se persiste). Se usa en Catálogo y Mercado con el mismo
 * aspecto y comportamiento.
 */
export function CategoryFilterChips({
	categories,
	value,
	onChange,
}: CategoryFilterChipsProps) {
	const chipClass = (active: boolean) =>
		cn(
			"min-h-[var(--min-height-tap)] shrink-0 rounded-[var(--radius-control)] border px-[18px] text-14",
			active
				? "border-foreground bg-foreground text-background"
				: "border-border text-foreground",
		);

	return (
		<div
			role="toolbar"
			aria-label="Filtrar por categoría"
			aria-orientation="horizontal"
			className="flex gap-2 overflow-x-auto px-4 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			<button
				type="button"
				aria-pressed={value === null}
				onClick={() => onChange(null)}
				className={chipClass(value === null)}
			>
				Todas
			</button>
			{categories.map((category) => (
				<button
					key={category.id}
					type="button"
					aria-pressed={value === category.id}
					onClick={() => onChange(value === category.id ? null : category.id)}
					className={chipClass(value === category.id)}
				>
					{category.name}
				</button>
			))}
		</div>
	);
}
