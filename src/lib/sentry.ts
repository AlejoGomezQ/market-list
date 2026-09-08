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
 */
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
	});
}
