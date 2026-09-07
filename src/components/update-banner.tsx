import { useRegisterSW } from "virtual:pwa-register/react";

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
 */
export function UpdateBanner() {
	const {
		needRefresh: [needRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		immediate: true,
		onOfflineReady() {
			console.log("La app ya puede abrir sin conexión.");
		},
	});

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
