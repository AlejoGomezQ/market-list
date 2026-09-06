import { z } from "zod";

/**
 * Frontera de validación de dominio/formularios (CLAUDE.md, D-023). Las otras dos fronteras
 * —Realtime e IndexedDB— se validan en fases posteriores.
 *
 * La forma sigue literalmente `supabase/migrations/*_domain_schema.sql`: mismos nombres, tipos y
 * nullability que las tablas. `households` y `household_members` no son tablas sincronizadas
 * (arquitectura §2.1) y por eso no llevan `deleted_at` ni `field_updated_at`.
 */

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

/** jsonb con la marca de tiempo por campo que sostiene la fusión de D-017/D-025 (arquitectura §2.1, §4). */
const fieldUpdatedAt = z.record(z.string(), timestamp);

export const householdSchema = z.object({
	id: uuid,
	name: z.string().min(1),
	join_code: z.string().min(1),
	created_at: timestamp,
	updated_at: timestamp,
});
export type Household = z.infer<typeof householdSchema>;

export const householdMemberSchema = z.object({
	household_id: uuid,
	user_id: uuid,
	joined_at: timestamp,
});
export type HouseholdMember = z.infer<typeof householdMemberSchema>;

export const supermarketSchema = z.object({
	id: uuid,
	household_id: uuid,
	name: z.string().min(1),
	position: z.number().int(),
	created_at: timestamp,
	updated_at: timestamp,
	deleted_at: timestamp.nullable(), // lápida absorbente, arquitectura §4.1
	field_updated_at: fieldUpdatedAt,
});
export type Supermarket = z.infer<typeof supermarketSchema>;

export const categorySchema = z.object({
	id: uuid,
	household_id: uuid,
	name: z.string().min(1),
	position: z.number().int(),
	created_at: timestamp,
	updated_at: timestamp,
	deleted_at: timestamp.nullable(), // lápida absorbente, arquitectura §4.1
	field_updated_at: fieldUpdatedAt,
});
export type Category = z.infer<typeof categorySchema>;

export const productSchema = z.object({
	id: uuid,
	household_id: uuid,
	name: z.string().min(1),
	brand: z.string().nullable(), // opcional, RF-012 / D-005
	category_id: uuid.nullable(),
	supermarket_id: uuid.nullable(), // opcional, D-002
	created_at: timestamp,
	updated_at: timestamp,
	deleted_at: timestamp.nullable(), // lápida absorbente, arquitectura §4.1
	field_updated_at: fieldUpdatedAt,
});
export type Product = z.infer<typeof productSchema>;

export const listItemSchema = z.object({
	id: uuid,
	household_id: uuid,
	product_id: uuid,
	quantity: z.number().int().positive(), // RF-011 / D-010, check (quantity > 0)
	checked: z.boolean(),
	checked_at: timestamp.nullable(),
	created_at: timestamp,
	updated_at: timestamp,
	removed_at: timestamp.nullable(), // lápida NO absorbente: D-032 la pone a nulo, arquitectura §4.1
	removed_reason: z.enum(["purchased", "removed"]).nullable(),
	field_updated_at: fieldUpdatedAt,
});
export type ListItem = z.infer<typeof listItemSchema>;
