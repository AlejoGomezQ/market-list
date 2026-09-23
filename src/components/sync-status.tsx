import type { QueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerBody,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { useSyncMutation } from "@/lib/sync/mutation";
import {
	getQuarantineSnapshot,
	removeFromQuarantine,
} from "@/lib/sync/quarantine";
import { useSyncStatus } from "@/lib/sync/use-sync-status";
import { cn } from "@/lib/utils";

/**
 * Indicador de estado de sincronización (D-012, estrategia_sincronizacion §9). Dos formas, no una:
 *
 * - "Todo guardado" / "Guardando cambios…" / "Sin conexión" son una línea discreta bajo el título --
 *   "sin ruido, sin animaciones" (§9), y el color solo aparece para "sin conexión" (`--alert`, identidad_visual
 *   §2: "sin conexión, cambios pendientes" es literalmente su descripción de uso).
 * - "Cambios en cuarentena" es la excepción explícita: "una franja única con el número", que ahora
 *   abre un *drawer* con el detalle -- el inspector que §9 dejaba pendiente "el día que haga
 *   falta". Manda sobre los otros tres estados.
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
	const sync = useSyncMutation();
	const [copied, setCopied] = useState(false);
	const [detailOpen, setDetailOpen] = useState(false);

	if (status.kind === "quarantined") {
		const entries = getQuarantineSnapshot();

		async function handleCopy() {
			const detail = JSON.stringify(entries, null, 2);
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

		/**
		 * Reintentar: acción explícita del usuario, no un auto-clear (§9 sigue prohibiendo borrar
		 * en silencio). Se saca de la cuarentena de inmediato -- optimista, como cualquier otra
		 * escritura de esta app -- y se vuelve a encolar en la mutación única; si `sync_push` la
		 * vuelve a rechazar de forma permanente, el pipeline normal (`quarantineSinglePatch` en
		 * `sync/mutation.ts`) la repone solo, sin lógica nueva aquí.
		 */
		function handleRetry(patchId: string) {
			const entry = entries.find((e) => e.patch.id === patchId);
			if (!entry) return;
			removeFromQuarantine(patchId);
			sync.mutate([entry.patch]);
		}

		/** Descartar: para un parche obsoleto que ya no aplica. Nunca se reenvía. */
		function handleDiscard(patchId: string) {
			removeFromQuarantine(patchId);
		}

		return (
			<>
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
						onClick={() => setDetailOpen(true)}
						className="min-h-[var(--min-height-tap)] px-2 font-bold underline underline-offset-2"
					>
						Ver detalle
					</button>
				</div>

				<Drawer open={detailOpen} onOpenChange={setDetailOpen}>
					<DrawerContent>
						<DrawerHeader>
							<DrawerTitle>Cambios en cuarentena</DrawerTitle>
						</DrawerHeader>
						<DrawerBody className="gap-0">
							<ul className="flex flex-col">
								{entries.map((entry) => (
									<li
										key={entry.patch.id}
										className="flex flex-col gap-2 border-b border-border py-3 first:pt-0"
									>
										<p className="text-14 font-bold">{entry.patch.entity}</p>
										<p className="text-13 text-muted-foreground">
											{entry.reason}
										</p>
										<div className="flex gap-2">
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="min-h-[var(--min-height-tap)]"
												onClick={() => handleRetry(entry.patch.id)}
											>
												<RefreshCw aria-hidden="true" strokeWidth={1.75} />
												Reintentar
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="min-h-[var(--min-height-tap)] text-destructive"
												onClick={() => handleDiscard(entry.patch.id)}
											>
												<Trash2 aria-hidden="true" strokeWidth={1.75} />
												Descartar
											</Button>
										</div>
									</li>
								))}
							</ul>
						</DrawerBody>
						<DrawerFooter>
							<Button
								type="button"
								variant="outline"
								className="min-h-[var(--min-height-tap)] w-full"
								onClick={handleCopy}
							>
								{copied ? "Copiado" : "Copiar detalle"}
							</Button>
						</DrawerFooter>
					</DrawerContent>
				</Drawer>
			</>
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
