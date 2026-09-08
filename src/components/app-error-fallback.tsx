/**
 * Pantalla de último recurso cuando un render revienta (envuelta por `Sentry.ErrorBoundary` en
 * `App.tsx`, que ya se encarga de reportar la excepción). En PWA a pantalla completa no hay botón
 * de atrás, así que la única salida es recargar. Tono identidad_visual §8: qué pasó y qué hacer,
 * sin disculparse. Acromática, sin iconos, sin emojis.
 */
export function AppErrorFallback() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
			<p className="text-20 font-bold tracking-[var(--tracking-label)] text-foreground wdth-75">
				La app se quedó a medias.
			</p>
			<p className="text-14 text-muted-foreground">
				Tus datos están guardados en el dispositivo. Recarga para continuar.
			</p>
			<button
				type="button"
				onClick={() => {
					window.location.reload();
				}}
				className="min-h-[var(--min-height-tap)] rounded-[var(--radius-control)] bg-foreground px-6 text-14 font-bold text-background"
			>
				Recargar
			</button>
		</div>
	);
}
