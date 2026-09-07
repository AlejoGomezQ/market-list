import { createCn } from "cn/config";

// `cn` (tailwind-merge) no conoce la escala tipográfica custom del proyecto
// (--text-13/14/17/20/26, definida en index.css). Sin esto, un `text-17`
// pasado como className choca con `text-primary-foreground`/`text-*-foreground`
// en el mismo grupo de conflicto ("color de texto") y el merge se queda solo
// con el que llega después -- que casi siempre es el tamaño, no el color.
// Resultado real visto en pantalla: texto negro sobre botón negro en
// cualquier Button que combine variant="default" con un className de tamaño.
export const cn = createCn({
	extend: {
		classGroups: {
			"font-size": [{ text: ["13", "14", "17", "20", "26"] }],
		},
	},
});
