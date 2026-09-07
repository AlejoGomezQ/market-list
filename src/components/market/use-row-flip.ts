import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * El único momento con movimiento de toda la app (identidad_visual_v0.1.md §6): al marcar, la fila
 * viaja hasta el grupo de comprados, 200 ms con curva de salida. Sin librería nueva -- las
 * mutaciones ya reordenan `pending`/`checked` (selectors.ts#splitByChecked) de un render al
 * siguiente, así que basta con una técnica FLIP mínima: medir la posición de cada fila antes de
 * repintar, aplicar el desplazamiento como `transform` nada más montar y soltarlo con una
 * transición en el frame siguiente. Nada más se anima así (identidad_visual §6, "nada más se
 * mueve"), por eso este hook está atado a la forma concreta de las filas del Mercado y no es un
 * sistema de animación genérico.
 */
export function useRowFlip(
	containerRef: RefObject<HTMLElement | null>,
	orderKey: string,
) {
	const prevRects = useRef<Map<string, DOMRect>>(new Map());

	// biome-ignore lint/correctness/useExhaustiveDependencies: orderKey es la señal de "vuelve a medir", no se lee dentro del efecto.
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const rows = container.querySelectorAll<HTMLElement>("[data-row-id]");

		const reducedMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		if (!reducedMotion) {
			for (const row of rows) {
				const id = row.dataset.rowId;
				if (!id) continue;
				const prev = prevRects.current.get(id);
				if (!prev) continue;
				const next = row.getBoundingClientRect();
				const deltaY = prev.top - next.top;
				if (deltaY === 0) continue;

				row.style.transition = "none";
				row.style.transform = `translateY(${deltaY}px)`;
				// Fuerza el reflow para que el navegador registre la posición de partida antes de
				// soltar la transición en el siguiente frame (si no, las dos escrituras se
				// coalescen y la fila nunca se ve moverse).
				row.getBoundingClientRect();
				requestAnimationFrame(() => {
					row.style.transition = "transform 200ms ease-out";
					row.style.transform = "";
				});
			}
		}

		const nextRects = new Map<string, DOMRect>();
		for (const row of rows) {
			const id = row.dataset.rowId;
			if (id) nextRects.set(id, row.getBoundingClientRect());
		}
		prevRects.current = nextRects;
		// orderKey cambia cada vez que el conjunto pendiente/comprado de esta sección pudo haberse
		// movido -- es la señal de cuándo volver a medir.
	}, [orderKey, containerRef]);
}
