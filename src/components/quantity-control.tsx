import { Minus, Plus, ShoppingCartPlus } from "lucide-react";

interface QuantityControlProps {
	/** 0 = el producto no está en la lista de mercado todavía. */
	quantity: number;
	productName: string;
	onAdd: () => void;
	onIncrement: () => void;
	onDecrement: () => void;
	/**
	 * Solo lo usa el Mercado: la cifra central también es tocable, para poder cerrar el contador
	 * que se abrió al tocarla (experiencia_usuario §4, "tocarla abre el contador ahí mismo"). El
	 * Catálogo no lo pasa -- ahí el contador está siempre abierto y la cifra es texto plano.
	 */
	onQuantityTap?: () => void;
}

/**
 * El control combinado de D-034: fuera de la lista es un carrito con `+` (comunica "meter en la
 * compra", no "sumar"); al tocarlo entra con cantidad 1 y el propio botón se convierte en el
 * contador `− 1 +` -- el segundo toque en `+` ya sube a 2. Cierra
 * UX-002 y UX-003 a la vez, con un solo control. Bajar a 0 (un toque en `−` con cantidad 1) quita
 * de la lista (RN-003: el producto sigue en el catálogo).
 *
 * Vive fuera de `catalog/` porque el Mercado también lo usa (experiencia_usuario §4, "tocar la
 * cifra abre el contador ahí mismo") -- mismo control, dos sitios de entrada.
 */
export function QuantityControl({
	quantity,
	productName,
	onAdd,
	onIncrement,
	onDecrement,
	onQuantityTap,
}: QuantityControlProps) {
	// `stopPropagation` en los tres botones: el único sitio donde importa es el Mercado, cuya fila
	// entera marca al tocarla (D-034 comparte el control con el Catálogo, donde no hay ningún
	// `onClick` de fila del que protegerse -- parar la propagación ahí es un no-op inofensivo).
	if (quantity <= 0) {
		return (
			<button
				type="button"
				aria-label={`Agregar ${productName} a la lista`}
				onClick={(event) => {
					event.stopPropagation();
					onAdd();
				}}
				className="flex size-[var(--min-height-tap)] items-center justify-center text-foreground"
			>
				<ShoppingCartPlus
					aria-hidden="true"
					className="size-5"
					strokeWidth={1.75}
				/>
			</button>
		);
	}

	return (
		<div className="flex items-center">
			<button
				type="button"
				aria-label={`Quitar una unidad de ${productName}`}
				onClick={(event) => {
					event.stopPropagation();
					onDecrement();
				}}
				className="flex size-[var(--min-height-tap)] items-center justify-center text-foreground"
			>
				<Minus aria-hidden="true" className="size-4" strokeWidth={1.75} />
			</button>
			{onQuantityTap ? (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onQuantityTap();
					}}
					className="min-w-[2ch] text-center text-17 tabular-nums text-foreground"
				>
					{quantity}
				</button>
			) : (
				<span className="min-w-[2ch] text-center text-17 tabular-nums text-foreground">
					{quantity}
				</span>
			)}
			<button
				type="button"
				aria-label={`Agregar una unidad de ${productName}`}
				onClick={(event) => {
					event.stopPropagation();
					onIncrement();
				}}
				className="flex size-[var(--min-height-tap)] items-center justify-center text-foreground"
			>
				<Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
			</button>
		</div>
	);
}
