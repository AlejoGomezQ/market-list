import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ensureAnonymousSession } from "./lib/auth.ts";
import { queryClient } from "./lib/query-client.ts";
import { startOutboxQueue } from "./lib/sync/queue.ts";

// RF-022/D-020: sin esto no hay `auth.uid()` con el que `is_member()` (RLS) o `create_household`/
// `join_household` puedan trabajar. Sin esperar (no bloquea el primer render, D-016/local-first: la
// interfaz nunca depende de la red para aparecer) -- el propio Onboarding vuelve a esperar esta
// misma función antes de llamar a create_household/join_household (`onboarding-screen.tsx`), que
// es el único punto donde de verdad hace falta que ya exista sesión.
void ensureAnonymousSession().catch((error) => {
	console.error("No se pudo iniciar la sesión anónima:", error);
});

// Fase 6/estrategia_sincronizacion §3.2: "subir antes de bajar". Arranca cuanto antes, sin
// esperar a que React monte -- `setMutationDefaults` ya ocurrió de forma síncrona al crear
// `queryClient` (`query-client.ts`), así que restaurar y reanudar la cola aquí es seguro.
void startOutboxQueue(queryClient).catch((error) => {
	console.error("No se pudo restaurar la cola de salida:", error);
});

// registerType: 'prompt' (vite.config.ts): no autoUpdate, así que el nuevo
// service worker queda esperando hasta que se le avise al usuario. Por ahora
// no hay UI para ese aviso — TODO Fase 7: UI del aviso de actualización.
registerSW({
	immediate: true,
	onNeedRefresh() {
		// TODO Fase 7: UI del aviso de actualización (banner/drawer con acción
		// para recargar). Hasta entonces, el SW nuevo queda en espera y no se
		// activa solo: eso es justamente lo que evita autoUpdate.
		console.log("Hay una actualización de la app esperando para instalarse.");
	},
	onOfflineReady() {
		console.log("La app ya puede abrir sin conexión.");
	},
});

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("No se encontró el elemento #root en index.html");
}

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
