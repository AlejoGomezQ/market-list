import { usePushSubscription } from "@/lib/push-subscription";
import { cn } from "@/lib/utils";

/**
 * Interruptor de notificaciones push (docs/plan_notificaciones_push_v0.1.md, Fase P1 / D-059):
 * "Avisarme cuando se cierre una compra", apagado por defecto, en Ajustes -- nunca en onboarding
 * (§9 P1: iOS solo muestra el diálogo del sistema una vez, y pedirlo antes de que el usuario
 * entienda para qué sirve es la vía directa a un "No permitir" permanente).
 *
 * Sin icono de campana: identidad_visual §5 limita los iconos a los que ya están en uso (buscar,
 * ajustes, más, menos, cerrar, papelera, sin conexión) -- "si un icono necesita una etiqueta al
 * lado para entenderse, sobra el icono", y aquí ya hay etiqueta.
 *
 * El interruptor propio (no `shadcn/ui`) sigue la retícula de identidad_visual §4: radio de 4px
 * -- reservado para controles --, nunca la píldora que el documento reserva solo para el contador
 * de cantidad. La fila entera es la zona de toque (CLAUDE.md), no solo el interruptor visual.
 */
export function NotificationsSection() {
	const { status, pending, error, enable, disable } = usePushSubscription();
	const checked = status === "on";
	const disabled = pending || status === "unsupported";

	function toggle() {
		if (disabled) return;
		if (checked) {
			void disable();
		} else {
			void enable();
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<p className="text-13 text-muted-foreground">Notificaciones</p>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={toggle}
				className="flex min-h-[var(--min-height-tap)] w-full items-center justify-between gap-3 text-left disabled:opacity-50"
			>
				<span className="text-17">Avisarme cuando se cierre una compra</span>
				<span
					aria-hidden="true"
					className={cn(
						"relative h-6 w-11 shrink-0 rounded-lg border transition-colors",
						checked
							? "border-foreground bg-foreground"
							: "border-border bg-background",
					)}
				>
					<span
						className={cn(
							"absolute top-0.5 left-0.5 size-5 rounded-sm bg-muted-foreground transition-transform",
							checked && "translate-x-5 bg-background",
						)}
					/>
				</span>
			</button>
			{status === "unsupported" && (
				<p className="text-14 text-muted-foreground">
					Este dispositivo no admite notificaciones push.
				</p>
			)}
			{status === "denied" && (
				<p className="text-14 text-alert">
					El permiso está denegado en este dispositivo. Actívalo desde Ajustes
					de iOS &gt; Notificaciones para volver a intentarlo.
				</p>
			)}
			{status === "off" && (
				<p className="text-14 text-muted-foreground">
					Las notificaciones están desactivadas en este dispositivo.
				</p>
			)}
			{error && (
				<p role="alert" className="text-14 text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
