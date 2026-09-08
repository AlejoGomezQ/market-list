import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ensureAnonymousSession } from "./lib/auth.ts";
import { reportError } from "./lib/errors.ts";
import { queryClient } from "./lib/query-client.ts";
import { initSentry } from "./lib/sentry.ts";
import { startOutboxQueue } from "./lib/sync/queue.ts";

// Antes que nada, para que capture cualquier fallo del arranque de abajo (backlog_v2 §7).
initSentry();

// RF-022/D-020: sin esto no hay `auth.uid()` con el que `is_member()` (RLS) o `create_household`/
// `join_household` puedan trabajar. Sin esperar (no bloquea el primer render, D-016/local-first: la
// interfaz nunca depende de la red para aparecer) -- el propio Onboarding vuelve a esperar esta
// misma función antes de llamar a create_household/join_household (`onboarding-screen.tsx`), que
// es el único punto donde de verdad hace falta que ya exista sesión.
void ensureAnonymousSession().catch((error) => {
	reportError(error, { op: "ensureAnonymousSession" });
});

// Fase 6/estrategia_sincronizacion §3.2: "subir antes de bajar". Arranca cuanto antes, sin
// esperar a que React monte -- `setMutationDefaults` ya ocurrió de forma síncrona al crear
// `queryClient` (`query-client.ts`), así que restaurar y reanudar la cola aquí es seguro.
void startOutboxQueue(queryClient).catch((error) => {
	reportError(error, { op: "startOutboxQueue" });
});

// registerType: 'prompt' (vite.config.ts): no autoUpdate, así que el nuevo service worker queda
// esperando hasta que se le avise al usuario. El registro y el aviso viven juntos en
// `UpdateBanner` (componente React, montado en `App.tsx` vía `useRegisterSW`) -- Fase 7. Llamar a
// `registerSW` otra vez aquí registraría el service worker por duplicado.

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("No se encontró el elemento #root en index.html");
}

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
