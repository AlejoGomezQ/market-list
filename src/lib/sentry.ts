import * as Sentry from "@sentry/react";

/**
 * Seguimiento de errores (backlog_v2 §7). El DSN llega por `VITE_SENTRY_DSN` y se inyecta en el
 * build de Vercel: en local y en los tests la variable no existe y `initSentry` no hace nada, así
 * que Sentry nunca se activa fuera de producción. El DSN es público por diseño (solo permite
 * enviar eventos, no leerlos), así que vive en el bundle sin problema.
 *
 * `sendDefaultPii: false`: no se mandan cabeceras, cookies ni IP. El código del hogar es una
 * credencial de facto (D-014) y no debe acabar en un evento -- no se registra en logs ni en
 * breadcrumbs, y al no ir en la URL como parámetro de ruta, Sentry no lo captura solo.
 *
 * `beforeSend` cierra lo que `sendDefaultPii: false` no cubre: la lista y el catálogo son datos
 * privados de dos personas y no deben salir del dispositivo aunque un fallo los tenga a mano.
 */

/**
 * Claves de `extra` que sí pueden viajar: diagnóstico sin contenido del hogar. Se pasan por
 * `reportError` (`op`) y `reportEvent` desde la cuarentena (`entity`, `patchId`, `fields`,
 * `reason`, `quarantinedAt`). `fields` son nombres de columna, no valores; `reason` es el texto de
 * un `raise exception` de `sync_push` (ids y nombre de función, nunca un nombre de producto).
 */
const EXTRA_ALLOWLIST = new Set([
	"op",
	"entity",
	"patchId",
	"fields",
	"reason",
	"quarantinedAt",
]);

/** Deja origin + path, quita la query string (puede llevar filtros con ids). No lanza. */
function stripQueryString(url: string | undefined): string | undefined {
	if (!url) return url;
	const q = url.indexOf("?");
	return q === -1 ? url : url.slice(0, q);
}

/** `beforeSend`: exportada para poder probarla sin arrancar Sentry. */
export function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
	if (event.request) {
		event.request.url = stripQueryString(event.request.url);
		event.request.query_string = undefined;
		event.request.data = undefined;
		event.request.cookies = undefined;
		event.request.headers = undefined;
	}
	if (event.extra) {
		event.extra = Object.fromEntries(
			Object.entries(event.extra).filter(([key]) => EXTRA_ALLOWLIST.has(key)),
		);
	}
	// Los breadcrumbs de fetch/xhr guardan la URL completa de cada llamada a Supabase.
	for (const crumb of event.breadcrumbs ?? []) {
		if (crumb.data && typeof crumb.data.url === "string") {
			crumb.data.url = stripQueryString(crumb.data.url);
		}
	}
	return event;
}

export function initSentry(): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	Sentry.init({
		dsn,
		environment:
			import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
		release: import.meta.env.VITE_SENTRY_RELEASE,
		integrations: [Sentry.browserTracingIntegration()],
		// El hogar son dos personas: el volumen de trazas es mínimo, así que se muestrean todas
		// para tener el contexto de red (sync_push, delta pull) cuando algo falla.
		tracesSampleRate: 1,
		sendDefaultPii: false,
		beforeSend: scrub,
	});
}
