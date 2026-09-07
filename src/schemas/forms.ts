import { z } from "zod";

/**
 * Frontera de formularios (CLAUDE.md, D-023): supermercados, categorías y productos comparten la
 * misma regla mínima de nombre -- no vacío tras recortar espacios -- así que es un solo esquema en
 * vez de tres copias.
 */
export const nameFieldSchema = z.string().trim().min(1, "Ponle un nombre.");

/** Alta de producto (RF-001): solo el nombre es obligatorio; marca, categoría y supermercado son
 * opcionales (D-002, D-004, D-005). */
export const productFormSchema = z.object({
	name: nameFieldSchema,
	brand: z.string().trim().min(1).nullable(),
	categoryId: z.uuid().nullable(),
	supermarketId: z.uuid().nullable(),
});
export type ProductFormInput = z.infer<typeof productFormSchema>;
