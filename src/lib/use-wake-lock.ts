import { useEffect, useRef } from "react";

/**
 * Screen Wake Lock API (experiencia_usuario §11, plan_implementacion Fase 7): mantiene la
 * pantalla encendida mientras `active` sea true -- en la práctica, Mercado visible y con al menos
 * un pendiente (`MercadoScreen` decide esa condición, este hook solo la ejecuta). Safari la
 * soporta desde iOS 16.4, pero no todos los navegadores la traen: se comprueba `'wakeLock' in
 * navigator` y, si no existe, esto no hace nada -- es una mejora opcional (experiencia_usuario
 * §11: "es de lo que más se agradece en uso real", no un requisito de RNF-001).
 *
 * Limitación conocida de la API: el navegador libera el lock solo al perder visibilidad (cambiar
 * de app o bloquear el teléfono) y no lo recupera por su cuenta al volver -- hay que escuchar
 * `visibilitychange` y volver a pedirlo si `active` se sigue cumpliendo.
 */
export function useWakeLock(active: boolean) {
	const lockRef = useRef<WakeLockSentinel | null>(null);

	useEffect(() => {
		if (!active || !("wakeLock" in navigator)) return;

		let cancelled = false;

		async function acquire() {
			try {
				const lock = await navigator.wakeLock.request("screen");
				if (cancelled) {
					// `active` cambió a false (o el componente se desmontó) mientras la promesa
					// seguía en vuelo: soltar de inmediato en vez de dejarla viva sin dueño.
					lock.release().catch(() => {});
					return;
				}
				lockRef.current = lock;
				lock.addEventListener("release", () => {
					if (lockRef.current === lock) lockRef.current = null;
				});
			} catch {
				// Permiso denegado, batería baja u otro motivo del navegador: no hay nada más que
				// ofrecer que dejar la pantalla apagarse sola, que es el comportamiento sin esto.
			}
		}

		void acquire();

		function handleVisibilityChange() {
			if (document.visibilityState === "visible" && !lockRef.current) {
				void acquire();
			}
		}
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			lockRef.current?.release().catch(() => {});
			lockRef.current = null;
		};
	}, [active]);
}
