import { useRegisterSW } from "virtual:pwa-register/react";
import { useEffect, useState } from "react";

/**
 * Cada cuánto se le pregunta al navegador si `sw.js` cambió. `registerType: 'prompt'`
 * (vite.config.ts) no trae chequeo periódico: sin esto, un service worker nuevo solo se detecta al
 * cargar la página en frío, y en una PWA de iOS "volver a la app" normalmente reanuda la página
 * congelada en vez de recargarla, así que un dispositivo puede quedarse días en una versión vieja
 * mientras el otro ya actualizó. Una hora es el intervalo del ejemplo de vite-plugin-pwa.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Aviso de versión nueva (experiencia_usuario §11, "aviso discreto, nunca recarga por
 * sorpresa"; plan_implementacion Fase 7). `registerType: 'prompt'` (vite.config.ts) deja el
 * service worker nuevo esperando hasta que se confirme -- sin esta interfaz quedaba solo en
 * consola (Fase 0). Vive en `App.tsx`, no en `AppShell` ni en Mercado, para verse también en
 * onboarding: cualquier pantalla, no solo una.
 *
 * `useRegisterSW` sustituye por completo al `registerSW` manual que vivía en `main.tsx`: llamar
 * a los dos registraría el service worker dos veces. Tocar "Actualizar" llama a
 * `updateServiceWorker(true)`, que manda el mensaje de skip-waiting al SW en espera; cuando ese
 * SW toma el control, la propia librería recarga la página (no se pasa `onNeedReload`, así que
 * usa su recarga por defecto).
 *
 * `onRegisteredSW` captura el `ServiceWorkerRegistration` para pedirle un `update()` periódico y
 * cada vez que la app vuelve a primer plano: es lo que hace que los dos dispositivos del hogar
 * converjan a la misma versión sin tener que matar la app. `update()` solo re-descarga `sw.js`;
 * si no cambió, no ocurre nada.
 */
export function UpdateBanner() {
	const [registration, setRegistration] = useState<
		ServiceWorkerRegistration | undefined
	>();

	const {
		needRefresh: [needRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		immediate: true,
		onRegisteredSW(_swScriptUrl, r) {
			setRegistration(r);
		},
		onOfflineReady() {
			console.log("La app ya puede abrir sin conexión.");
		},
	});

	useEffect(() => {
		if (!registration) return;
		const check = () => {
			registration.update().catch(() => {
				// Sin red, o el navegador rechaza el chequeo: se reintenta en el siguiente ciclo.
			});
		};
		const interval = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") check();
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [registration]);

	if (!needRefresh) return null;

	return (
		<div
			role="alert"
			className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 border-b border-border bg-foreground px-4 pb-3 text-background"
			style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
		>
			<span className="text-14">Hay una versión nueva.</span>
			<button
				type="button"
				onClick={() => updateServiceWorker(true)}
				className="min-h-[var(--min-height-tap)] px-2 text-14 font-bold underline underline-offset-2"
			>
				Actualizar
			</button>
		</div>
	);
}
