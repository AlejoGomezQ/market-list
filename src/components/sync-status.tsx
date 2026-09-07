import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getQuarantineSnapshot } from "@/lib/sync/quarantine";
import { useSyncStatus } from "@/lib/sync/use-sync-status";
import { cn } from "@/lib/utils";

/**
 * Indicador de estado de sincronización (D-012, estrategia_sincronizacion §9). Dos formas, no una:
 *
 * - "Todo guardado" / "Guardando cambios…" / "Sin conexión" son una línea discreta bajo el título --
 *   "sin ruido, sin animaciones" (§9), y el color solo aparece para "sin conexión" (`--alert`, identidad_visual
 *   §2: "sin conexión, cambios pendientes" es literalmente su descripción de uso).
 * - "Cambios en cuarentena" es la excepción explícita: "una franja única con el número y una
 *   acción de copiar el detalle", no una línea más. Manda sobre los otros tres estados.
 *
 * Ninguna de las dos formas anima nada -- el único movimiento de la app sigue siendo la fila que
 * viaja al marcarse (identidad_visual §1).
 */
export function SyncStatusIndicator({
	queryClient,
}: {
	queryClient: QueryClient;
}) {
	const status = useSyncStatus(queryClient);
	const [copied, setCopied] = useState(false);

	if (status.kind === "quarantined") {
		async function handleCopy() {
			const detail = JSON.stringify(getQuarantineSnapshot(), null, 2);
			try {
				await navigator.clipboard.writeText(detail);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch {
				// Portapapeles no disponible (contexto no seguro, permiso denegado): no hay nada más
				// que ofrecer aquí -- el detalle sigue en `getQuarantineSnapshot()` para quien lo pida
				// por otra vía (consola, informe manual).
			}
		}

		return (
			<div
				role="alert"
				// `-mx-4`: cancela el `px-4` de la cabecera de Mercado (`mercado-screen.tsx`) para que
				// la franja llegue borde a borde, como pide §9 ("franja única"), en vez de quedarse
				// dentro del margen del título.
				className="-mx-4 flex items-center justify-between gap-3 border-b border-border bg-destructive px-4 py-2 text-13 text-destructive-foreground"
			>
				<span>
					{status.count}{" "}
					{status.count === 1
						? "cambio en cuarentena"
						: "cambios en cuarentena"}
				</span>
				<button
					type="button"
					onClick={handleCopy}
					className="min-h-[var(--min-height-tap)] px-2 font-bold underline underline-offset-2"
				>
					{copied ? "Copiado" : "Copiar detalle"}
				</button>
			</div>
		);
	}

	const label =
		status.kind === "offline"
			? `Sin conexión · ${status.pendingCount} ${status.pendingCount === 1 ? "pendiente" : "pendientes"}`
			: status.kind === "uploading"
				? "Guardando cambios…"
				: "Todo guardado";

	return (
		<p
			className={cn(
				"text-13",
				status.kind === "offline" ? "text-alert" : "text-muted-foreground",
			)}
		>
			{label}
		</p>
	);
}
