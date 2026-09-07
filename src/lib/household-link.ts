import { z } from "zod";

const STORAGE_KEY = "market-list:household";

/**
 * Vínculo de este dispositivo con su hogar: quién soy, no qué hay en el catálogo. Vive en
 * `localStorage`, no en la caché de TanStack Query -- `households` no es una de las cuatro tablas
 * sincronizadas (arquitectura §2.1, `household-tables.ts`), y hace falta poder leerlo de forma
 * síncrona en el `beforeLoad` del router, antes de que exista ningún `QueryClient` hidratado.
 *
 * `joinCode` se guarda aquí en vez de volver a pedirlo a Supabase cada vez que se abre Ajustes:
 * este dispositivo es el único que puede cambiarlo (crear o regenerar), así que su propia copia
 * local ya es la verdad para él, y así Ajustes puede mostrarlo sin red (frontera Zod: CLAUDE.md).
 */
const householdLinkSchema = z.object({
	householdId: z.uuid(),
	name: z.string().min(1),
	joinCode: z.string().min(1),
});
export type HouseholdLink = z.infer<typeof householdLinkSchema>;

export function getHouseholdLink(): HouseholdLink | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return householdLinkSchema.parse(JSON.parse(raw));
	} catch {
		// localStorage inaccesible (modo privado agresivo) o contenido corrupto: se trata igual que
		// "sin hogar vinculado todavía" -- el onboarding vuelve a pedirlo, nunca se rompe la app.
		return null;
	}
}

export function setHouseholdLink(link: HouseholdLink): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(link));
}

/**
 * Actualiza solo el código, tras `regenerate_household_code` (D-040). Si por lo que sea no había
 * vínculo local todavía (no debería pasar: solo se regenera desde Ajustes, con hogar ya vinculado)
 * no hay nada que actualizar.
 */
export function updateStoredJoinCode(joinCode: string): void {
	const current = getHouseholdLink();
	if (!current) return;
	setHouseholdLink({ ...current, joinCode });
}

/**
 * Fase 0 dejó pendiente esta llamada para "el momento de vincularse a un hogar" (crear o unirse).
 * Best-effort: Safari puede denegarla sin que sea un error de la app (D-018, riesgo residual ya
 * asumido ahí), y el propio navegador la ignora si no la soporta.
 */
export async function requestPersistentStorage(): Promise<void> {
	try {
		await navigator.storage?.persist?.();
	} catch {
		// Ver comentario de arriba: best-effort, nunca bloquea ni rompe el flujo de vinculación.
	}
}
