/**
 * Compartir un texto plano sin backend (backlog_v2 §3): Web Share API si el dispositivo la trae
 * (Safari iOS y la PWA instalada), y si no, copia al portapapeles. Nunca lanza: el llamador decide
 * el aviso a partir del resultado.
 *
 * - `shared`: se abrió la hoja de compartir del sistema.
 * - `cancelled`: el usuario cerró esa hoja sin compartir (`AbortError`); no es un error.
 * - `copied`: no hay Web Share API, se copió al portapapeles.
 * - `failed`: compartir o copiar falló.
 */
export async function shareText(
	text: string,
): Promise<"shared" | "copied" | "cancelled" | "failed"> {
	if (
		typeof navigator !== "undefined" &&
		typeof navigator.share === "function"
	) {
		try {
			await navigator.share({ text });
			return "shared";
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				return "cancelled";
			}
			return "failed";
		}
	}

	try {
		await navigator.clipboard.writeText(text);
		return "copied";
	} catch {
		return "failed";
	}
}

/**
 * Texto de invitación a un hogar para compartir por WhatsApp (RF-022, D-014). El código va en
 * negrilla de WhatsApp (`*...*`), igual criterio que `formatMarketListForSharing`. Sin emojis
 * (D-035).
 */
export function formatHouseholdInvite(code: string): string {
	return `Con este código puedes unirte a un hogar y gestionar tu lista de mercado\n\n*${code}*`;
}
