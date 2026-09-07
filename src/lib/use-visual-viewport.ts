import { useEffect } from "react";

/**
 * En iOS el teclado de software NO encoge el viewport de layout: `100vh` / `100dvh` siguen
 * midiendo la pantalla completa, así que un drawer anclado a `bottom: 0` con `max-height`
 * relativa al layout queda con su mitad inferior (chips de supermercado, "Marca y categoría")
 * detrás del teclado y sin forma de scrollear hasta ahí.
 *
 * Este efecto publica el área realmente visible (`window.visualViewport`) como variables CSS
 * en `<html>`, y `drawer.tsx` (`index.css`, regla de `[data-slot="drawer-content"]`) las usa
 * para acotar su altura y levantarse por encima del teclado:
 *
 *   --vvh            altura visible, en px
 *   --vv-offset-top  desplazamiento superior del viewport visual, en px
 *
 * Sin `visualViewport` (fallback) no se escribe nada y el CSS cae a `100dvh` / `0`.
 * El trabajo se agrupa con `requestAnimationFrame` porque `resize`/`scroll` del viewport
 * visual disparan en ráfaga mientras el teclado se abre.
 */
export function useVisualViewport() {
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		const root = document.documentElement;
		let frame = 0;

		const sync = () => {
			frame = 0;
			root.style.setProperty("--vvh", `${vv.height}px`);
			root.style.setProperty("--vv-offset-top", `${vv.offsetTop}px`);
		};
		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(sync);
		};

		sync();
		vv.addEventListener("resize", schedule);
		vv.addEventListener("scroll", schedule);

		return () => {
			if (frame) cancelAnimationFrame(frame);
			vv.removeEventListener("resize", schedule);
			vv.removeEventListener("scroll", schedule);
			root.style.removeProperty("--vvh");
			root.style.removeProperty("--vv-offset-top");
		};
	}, []);
}
