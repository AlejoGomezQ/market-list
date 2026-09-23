import { useCallback, useEffect, useState } from "react";
import { AppError, reportError, toUserMessage } from "@/lib/errors";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import { pushSubscriptionRowSchema } from "@/schemas/push-subscription";

/**
 * Suscripción push del dispositivo (docs/plan_notificaciones_push_v0.1.md, Fase P1: "Modelo de
 * datos y suscripción"). Todo lo de aquí es cliente -- disparo y envío son Fase P2, manejadores
 * `push`/`notificationclick` del Service Worker de producción son Fase P3.
 *
 * `push_subscriptions` no es una de las cuatro tablas sincronizadas (CLAUDE.md): se escribe
 * directo contra Supabase, no por `sync_push`, y no hay optimismo que perder -- pedir permiso y
 * suscribirse es tan poco frecuente como crear/unirse a un hogar (`lib/household.ts`), así que
 * RNF-001 (cero indicador de carga en operaciones *frecuentes*) no aplica aquí.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
	| string
	| undefined;

function pushSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		"Notification" in window &&
		"serviceWorker" in navigator &&
		"PushManager" in window
	);
}

function requireSupabase() {
	if (!supabase) {
		throw new Error(supabaseConfigError ?? "Supabase no está configurado.");
	}
	return supabase;
}

/** VAPID llega en base64url (RFC 4648 §5); `pushManager.subscribe` exige un `Uint8Array`. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(base64);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

/** Fila `push_subscriptions` (frontera Zod) a partir de una `PushSubscription` del navegador. */
function toRow(subscription: PushSubscription, userId: string) {
	const json = subscription.toJSON();
	return pushSubscriptionRowSchema.parse({
		endpoint: subscription.endpoint,
		user_id: userId,
		p256dh: json.keys?.p256dh ?? "",
		auth: json.keys?.auth ?? "",
		user_agent: navigator.userAgent,
	});
}

async function currentUserId(): Promise<string> {
	const { data } = await requireSupabase().auth.getSession();
	const userId = data.session?.user.id;
	if (!userId)
		throw new AppError(
			"Tu sesión no está lista. Inténtalo de nuevo en un momento.",
		);
	return userId;
}

async function upsertRow(subscription: PushSubscription): Promise<void> {
	const userId = await currentUserId();
	const row = toRow(subscription, userId);
	const { error } = await requireSupabase()
		.from("push_subscriptions")
		.upsert(row, { onConflict: "endpoint" });
	if (error) throw error;
}

async function deleteRow(endpoint: string): Promise<void> {
	const { error } = await requireSupabase()
		.from("push_subscriptions")
		.delete()
		.eq("endpoint", endpoint);
	if (error) throw error;
}

/**
 * Suscribe este dispositivo. Debe llamarse dentro del handler de un toque (§2.1: iOS solo muestra
 * el diálogo del sistema si `requestPermission()` cuelga de un gesto del usuario), y por eso pide
 * el permiso como primer `await` de la función, antes de cualquier otra espera.
 */
export async function subscribeToPush(): Promise<void> {
	if (!pushSupported()) {
		throw new AppError("Este dispositivo no admite notificaciones push.");
	}
	if (!VAPID_PUBLIC_KEY) {
		throw new AppError("Las notificaciones no están configuradas todavía.");
	}

	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		throw new AppError(
			permission === "denied"
				? "Permiso denegado. Actívalo desde Ajustes de iOS > Notificaciones."
				: "No se concedió el permiso de notificaciones.",
		);
	}

	const registration = await navigator.serviceWorker.ready;
	const subscription =
		(await registration.pushManager.getSubscription()) ??
		(await registration.pushManager.subscribe({
			userVisibleOnly: true,
			// `as BufferSource`: TS 5.7+ tipa `Uint8Array` como genérico sobre su buffer
			// (`Uint8Array<ArrayBufferLike>`), y el lib.dom de `PushSubscriptionOptionsInit` sigue
			// pidiendo el `BufferSource` de siempre -- el valor es correcto en tiempo de ejecución,
			// es un desajuste de tipos entre ambos.
			applicationServerKey: urlBase64ToUint8Array(
				VAPID_PUBLIC_KEY,
			) as BufferSource,
		}));
	await upsertRow(subscription);
}

/** Desuscribe este dispositivo: borra la suscripción del navegador y su fila en el servidor. */
export async function unsubscribeFromPush(): Promise<void> {
	if (!pushSupported()) return;
	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return;
	const endpoint = subscription.endpoint;
	await subscription.unsubscribe();
	await deleteRow(endpoint);
}

/**
 * Revalidación al arrancar la app (llamada una vez desde `AppShell`, igual que
 * `useSyncEngine`): si ya había una suscripción activa (permiso concedido y el navegador todavía
 * la reconoce), la vuelve a subir. Cubre el caso en que el `endpoint` cambió -- la clave primaria
 * es el `endpoint`, así que resubir con uno nuevo no deja duplicados, solo una fila más que
 * quedará huérfana hasta que un envío fallido la limpie (Fase P2). Sin permiso concedido no hay
 * nada que revalidar: el interruptor sigue apagado por defecto (D-059).
 */
export async function reconcilePushSubscription(): Promise<void> {
	if (!pushSupported() || Notification.permission !== "granted") return;
	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return;
	await upsertRow(subscription);
}

export type PushSubscriptionStatus =
	| "unsupported" // navegador o falta de VITE_VAPID_PUBLIC_KEY
	| "denied" // permiso denegado a nivel de sistema: no se puede volver a pedir desde la web
	| "off" // permiso no concedido, o concedido pero sin suscripción activa
	| "on"; // permiso concedido y suscripción activa

async function readStatus(): Promise<PushSubscriptionStatus> {
	if (!pushSupported() || !VAPID_PUBLIC_KEY) return "unsupported";
	if (Notification.permission === "denied") return "denied";
	if (Notification.permission !== "granted") return "off";
	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	return subscription ? "on" : "off";
}

/**
 * Estado del interruptor de Ajustes: pedir permiso (`enable`) o su inverso (`disable`), más el
 * estado (D-061: distingue "apagado" de "denegado a nivel de sistema", que es un texto distinto
 * porque no admite volver a pedirlo desde aquí).
 */
export function usePushSubscription() {
	const [status, setStatus] = useState<PushSubscriptionStatus>("off");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		void readStatus().then(setStatus);
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const enable = useCallback(async () => {
		setPending(true);
		setError(null);
		try {
			await subscribeToPush();
			setStatus("on");
		} catch (err) {
			reportError(err, { op: "subscribeToPush" });
			setError(toUserMessage(err));
			// El mensaje ya distingue "denegado" de un fallo cualquiera (subscribeToPush lanza
			// AppError en ambos casos), pero el estado real -- para no volver a ofrecer el diálogo
			// del sistema si ya lo denegó -- se relee de Notification.permission, no se adivina.
			refresh();
		} finally {
			setPending(false);
		}
	}, [refresh]);

	const disable = useCallback(async () => {
		setPending(true);
		setError(null);
		try {
			await unsubscribeFromPush();
			setStatus("off");
		} catch (err) {
			reportError(err, { op: "unsubscribeFromPush" });
			setError(toUserMessage(err));
		} finally {
			setPending(false);
		}
	}, []);

	return { status, pending, error, enable, disable };
}
