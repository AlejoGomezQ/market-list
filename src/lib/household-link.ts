import { z } from "zod";

const STORAGE_KEY = "market-list:household";

/**
 * Vínculo de este dispositivo con un hogar: quién soy, no qué hay en el catálogo. Vive en
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

/**
 * Un dispositivo puede pertenecer a varios hogares y elegir cuál está activo (D-043). El "hogar
 * activo" es puramente local: no se sincroniza entre dispositivos, ni siquiera entre los dos de la
 * misma persona. La sincronización (Realtime, delta pull, cola) opera solo sobre el activo (D-044).
 */
const storedLinkSchema = z.object({
	households: z.array(householdLinkSchema),
	activeId: z.string(),
});
type StoredLink = z.infer<typeof storedLinkSchema>;

function writeStored(stored: StoredLink): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// localStorage inaccesible (modo privado agresivo): no se puede persistir. El llamador sigue
		// con su estado en memoria; la app no se rompe.
	}
}

/**
 * Si `activeId` ya no apunta a ningún hogar de la lista (p. ej. tras `removeHouseholdLink` en otra
 * pestaña, o storage a medio escribir), se corrige al primero y se reescribe. Lista vacía: se deja
 * como está y `getHouseholdLink` devolverá `null`.
 */
function normalizeActive(stored: StoredLink): StoredLink {
	if (stored.households.length === 0) return stored;
	if (stored.households.some((h) => h.householdId === stored.activeId)) {
		return stored;
	}
	const fixed = { ...stored, activeId: stored.households[0].householdId };
	writeStored(fixed);
	return fixed;
}

/**
 * Lee el objeto almacenado, con migración transparente del formato viejo
 * (`{ householdId, name, joinCode }`, un solo hogar) al nuevo (`{ households, activeId }`). Un
 * contenido corrupto o un `localStorage` inaccesible se tratan como "sin hogares" -- igual que el
 * `null` de siempre: el onboarding vuelve a pedirlo, nunca se rompe la app.
 */
function readStored(): StoredLink | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const json = JSON.parse(raw);

		const asNew = storedLinkSchema.safeParse(json);
		if (asNew.success) return normalizeActive(asNew.data);

		const asOld = householdLinkSchema.safeParse(json);
		if (asOld.success) {
			const migrated: StoredLink = {
				households: [asOld.data],
				activeId: asOld.data.householdId,
			};
			writeStored(migrated);
			return migrated;
		}

		return null;
	} catch {
		return null;
	}
}

/** Todos los hogares que sigue este dispositivo, en el orden en que se añadieron. */
export function getHouseholdLinks(): HouseholdLink[] {
	return readStored()?.households ?? [];
}

/**
 * El vínculo **activo** (`HouseholdLink | null`). Mantiene la firma de siempre para no tocar a sus
 * ~8 llamadores (router, `app-shell.tsx`, las pantallas): todos quieren "el hogar en el que estoy".
 */
export function getHouseholdLink(): HouseholdLink | null {
	const stored = readStored();
	if (!stored || stored.households.length === 0) return null;
	return (
		stored.households.find((h) => h.householdId === stored.activeId) ??
		stored.households[0]
	);
}

export function getActiveHouseholdId(): string | null {
	return getHouseholdLink()?.householdId ?? null;
}

/**
 * Cambia el hogar activo. No recarga: quien llama decide (la recarga la hace la Fase C, igual que
 * "salir del hogar" ya recarga hoy). No-op silencioso -- con aviso -- si el id no está en la lista.
 */
export function setActiveHousehold(id: string): void {
	const stored = readStored();
	if (!stored) return;
	if (!stored.households.some((h) => h.householdId === id)) {
		console.warn(
			`setActiveHousehold: el hogar ${id} no está en la lista local; se ignora`,
		);
		return;
	}
	writeStored({ ...stored, activeId: id });
}

/**
 * Añade un hogar, o actualiza el que ya exista con ese `householdId` (nombre o código nuevos). Con
 * `activate: true` -- o si era el primer hogar de la lista -- lo deja como activo.
 */
export function addHouseholdLink(
	link: HouseholdLink,
	opts?: { activate?: boolean },
): void {
	const stored = readStored();
	const households = stored?.households ?? [];
	const exists = households.some((h) => h.householdId === link.householdId);
	const nextHouseholds = exists
		? households.map((h) => (h.householdId === link.householdId ? link : h))
		: [...households, link];
	const activeId =
		opts?.activate || households.length === 0
			? link.householdId
			: (stored?.activeId ?? link.householdId);
	writeStored({ households: nextHouseholds, activeId });
}

/**
 * Vincula este dispositivo a un hogar y lo deja activo (crear o unirse, D-014). Azúcar sobre
 * `addHouseholdLink(link, { activate: true })`; se conserva porque lo usan el onboarding y los
 * tests de `App`.
 */
export function setHouseholdLink(link: HouseholdLink): void {
	addHouseholdLink(link, { activate: true });
}

/**
 * Quita un hogar de la lista. Si era el activo, promueve el primero que quede. Si la lista queda
 * vacía, deja el storage en estado "sin hogares" (el guardia del router lleva a onboarding).
 */
export function removeHouseholdLink(id: string): void {
	const stored = readStored();
	if (!stored) return;
	const households = stored.households.filter((h) => h.householdId !== id);
	if (households.length === 0) {
		clearHouseholdLink();
		return;
	}
	const activeId =
		stored.activeId === id ? households[0].householdId : stored.activeId;
	writeStored({ households, activeId });
}

/**
 * Actualiza solo el código, tras `regenerate_household_code` (D-040). Por defecto sobre el hogar
 * activo; se puede acotar a uno concreto con `householdId`. No hace nada si ese hogar no está
 * vinculado localmente.
 */
export function updateStoredJoinCode(
	joinCode: string,
	householdId?: string,
): void {
	const stored = readStored();
	if (!stored) return;
	const target = householdId ?? stored.activeId;
	if (!stored.households.some((h) => h.householdId === target)) return;
	writeStored({
		...stored,
		households: stored.households.map((h) =>
			h.householdId === target ? { ...h, joinCode } : h,
		),
	});
}

/**
 * Borra el vínculo local entero: este dispositivo deja de seguir ningún hogar (salir del último
 * hogar, D-014). El guardia de `router.tsx` manda a onboarding en cuanto esto queda sin hogares.
 * `try/catch` por lo mismo que `readStored`: si localStorage está inaccesible, no hay nada que
 * borrar.
 */
export function clearHouseholdLink(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// localStorage inaccesible (modo privado agresivo): no hay vínculo que borrar.
	}
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
