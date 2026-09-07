/**
 * Contraste WCAG (identidad_visual_v0.1.md §9, "el suelo de calidad"): los ocho colores de
 * supermercado llevan texto blanco encima (banda sólida + rótulo en `--paper`), así que el par que
 * importa es cada color contra blanco. Fórmula de luminancia relativa y ratio de contraste de
 * WCAG 2.x -- sin librería nueva, son quince líneas.
 */
export function relativeLuminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	const channel = (shift: number) => {
		const c = ((n >> shift) & 255) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function contrastRatio(hexA: string, hexB: string): number {
	const la = relativeLuminance(hexA);
	const lb = relativeLuminance(hexB);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Paleta cerrada de ocho (identidad_visual_v0.1.md #2, D-036). Debe coincidir con las
 * `--market-*` de `src/index.css` -- no hay una única fuente en tiempo de build para tokens CSS y
 * este valor de test, así que un cambio de paleta toca los dos sitios.
 */
export const SUPERMARKET_PALETTE: Record<string, string> = {
	rojo: "#B3261E",
	cobalto: "#1B4FD8",
	bosque: "#1F6B45",
	ocre: "#8A5A00",
	ciruela: "#6D2C6B",
	turquesa: "#0F5F6B",
	pizarra: "#3A4550",
	naranja: "#A8420F",
};

export const WHITE = "#FFFFFF";

/** AA para texto normal (17-19px, el tamaño real del rótulo de supermercado sobre la banda). */
export const AA_NORMAL_TEXT_RATIO = 4.5;

/**
 * `--destructive` en modo oscuro (Fase 5, ver `index.css`): el valor de claro (`#A32014`) da
 * 2.33:1 sobre `--paper` oscuro (`#17191A`), muy por debajo de AA. Debe coincidir con la
 * variable `--destructive` dentro de `@media (prefers-color-scheme: dark)` en `src/index.css`.
 */
export const DESTRUCTIVE_DARK = "#FA7E67";
export const PAPER_DARK = "#17191A";
