import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

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
