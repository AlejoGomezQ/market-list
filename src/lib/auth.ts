import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "@/lib/supabase";

/**
 * Distingue "sin red" de "sesión realmente inválida/expirada" (plan_implementacion Fase 2b).
 *
 * `@supabase/auth-js` (GoTrueClient) ya hace esta misma distinción puertas adentro al refrescar el
 * token: envuelve el fallo de una petición fetch que ni siquiera llegó al servidor en
 * `AuthRetryableFetchError`, y la reserva para eso -- un JWT rechazado de verdad llega como
 * `AuthApiError` con un código HTTP real. `isAuthRetryableFetchError` es la función exportada por
 * la librería para reconocer ese caso; reexportarla con este nombre es lo único que hace falta
 * aquí, no una reimplementación propia de la misma comprobación.
 */
export function isAuthNetworkError(error: unknown): boolean {
	return isAuthRetryableFetchError(error);
}

/**
 * Arranque de la sesión anónima (RF-022, D-020), pensado para llamarse una vez al iniciar la app
 * (`src/main.tsx`).
 *
 * `getSession()` primero: si ya hay una sesión guardada, la devuelve leyendo de almacenamiento
 * local, sin tocar la red. No hace falta comprobar aquí si esa sesión sigue siendo válida en el
 * servidor -- GoTrueClient ya decide por su cuenta si refrescarla, y si ese refresco falla por
 * red conserva la sesión existente en vez de destruirla (ver `_callRefreshToken`, que solo borra
 * la sesión cuando el access token ya expiró de verdad Y el refresh token fue rechazado, no
 * cuando la petición de refresco ni siquiera llegó al servidor). Reimplementar esa distinción
 * aquí encima sería la misma comprobación dos veces.
 *
 * Solo si no hay sesión ninguna se crea una anónima nueva. Un fallo de red en ese intento no es
 * fatal: todavía no hay nada que perder en este dispositivo (ni sesión ni hogar vinculado), así
 * que se registra y se reintenta solo en el próximo arranque de la app. Cualquier otro error
 * (proyecto mal configurado, credenciales rechazadas) si se propaga: eso sí es un problema real.
 */
export async function ensureAnonymousSession(): Promise<void> {
	if (!supabase) {
		console.error(supabaseConfigError);
		return;
	}

	const { data } = await supabase.auth.getSession();
	if (data.session) return;

	const { error } = await supabase.auth.signInAnonymously();
	if (!error) return;

	if (isAuthNetworkError(error)) {
		console.warn(
			"Sin red al crear la sesión anónima; se reintentará al reabrir la app.",
			error,
		);
		return;
	}
	throw error;
}
