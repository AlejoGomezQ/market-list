import { z } from "zod";

/**
 * Frontera Zod hacia `push_subscriptions` (CLAUDE.md, "tres fronteras"). No es una de las cuatro
 * tablas sincronizadas (arquitectura §2.1): sin `field_updated_at`, sin fusión LWW, así que no
 * comparte esquema con `schemas/domain.ts`. Forma literal de
 * `supabase/migrations/20260923120000_push_subscriptions.sql`.
 */
export const pushSubscriptionRowSchema = z.object({
	endpoint: z.url(),
	user_id: z.uuid(),
	p256dh: z.string().min(1),
	auth: z.string().min(1),
	user_agent: z.string().nullable(),
});
export type PushSubscriptionRow = z.infer<typeof pushSubscriptionRowSchema>;
