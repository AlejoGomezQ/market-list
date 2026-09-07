import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * El despliegue de Vercel actual no tiene estas variables configuradas todavía (el proyecto
 * remoto de Supabase es tarea pendiente del usuario). Sin esta guarda, `createClient(undefined,
 * undefined)` lanza en el momento de importar el módulo y se lleva toda la app abajo -- pantalla
 * en blanco sin ningún mensaje. Con la guarda, el cliente queda en `null`, el problema se ve en
 * consola y en un aviso mínimo (`AppShell`), y el resto de la app -- que en Fase 2a todavía no lee
 * de Supabase desde ninguna pantalla -- sigue funcionando con normalidad.
 */
export const supabaseConfigError: string | null =
	!url || !anonKey
		? "Faltan las variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. La app funciona localmente pero no puede sincronizar."
		: null;

if (supabaseConfigError) {
	console.error(supabaseConfigError);
}

export const supabase: SupabaseClient | null = supabaseConfigError
	? null
	: createClient(url, anonKey);
