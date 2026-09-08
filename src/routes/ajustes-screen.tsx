import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CategoriesSection } from "@/components/settings/categories-section";
import { SupermarketsSection } from "@/components/settings/supermarkets-section";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerBody,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { leaveHousehold, regenerateHouseholdCode } from "@/lib/household";
import {
	clearHouseholdLink,
	getHouseholdLink,
	updateStoredJoinCode,
} from "@/lib/household-link";
import { clearPersistedSyncState } from "@/lib/query-client";
import { useSyncStatus } from "@/lib/sync/use-sync-status";

/**
 * Ajustes como drawer desde abajo (D-023), no como pantalla propia -- cuelga de `/catalogo` en
 * `router.tsx`. Cerrarlo (deslizar, tocar fuera, o el botón) es simplemente volver a `/catalogo`:
 * es la "salida visible" que exige experiencia_usuario §11 en ausencia de botón de atrás.
 *
 * El código regenerado se lee de la respuesta de `regenerate_household_code`, no de un delta pull:
 * esta pantalla es la única que puede cambiarlo desde este dispositivo, así que su propio estado
 * tras la llamada ya es la verdad (mismo razonamiento que `household-link.ts`).
 */
export function AjustesDrawer() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const sync = useSyncStatus(queryClient);
	const [link, setLink] = useState(() => getHouseholdLink());
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [leaveOpen, setLeaveOpen] = useState(false);
	const [leavePending, setLeavePending] = useState(false);
	const [leaveError, setLeaveError] = useState<string | null>(null);

	// Cambios que aún no llegaron al servidor: pausados por falta de red, o en cuarentena (rechazo
	// permanente, que nunca se resuelve solo). Salir vacía IndexedDB, así que estos se pierden.
	const unsyncedCount =
		sync.kind === "offline"
			? sync.pendingCount
			: sync.kind === "quarantined"
				? sync.count
				: 0;

	function close() {
		navigate({ to: "/catalogo" });
	}

	async function handleRegenerate() {
		setPending(true);
		setError(null);
		try {
			const joinCode = await regenerateHouseholdCode();
			updateStoredJoinCode(joinCode);
			setLink((current) => (current ? { ...current, joinCode } : current));
			setConfirmOpen(false);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "No se pudo regenerar el código.",
			);
		} finally {
			setPending(false);
		}
	}

	async function handleLeave() {
		setLeavePending(true);
		setLeaveError(null);
		try {
			await leaveHousehold();
			clearHouseholdLink();
			await clearPersistedSyncState();
			// Recarga completa en vez de navigate(): es la única forma segura de tirar el QueryClient
			// en memoria, el motor de sync (Realtime + delta pull de AppShell) y la suscripción de la
			// cola de salida (main.tsx). Al rearrancar sin vínculo local, el guardia de router.tsx
			// lleva a onboarding. No se restablece leavePending: la página se va.
			window.location.assign("/");
		} catch (err) {
			// El texto crudo de la excepción (p. ej. un error de IndexedDB) no le sirve a nadie de
			// pie en un pasillo: mensaje fijo en español (identidad_visual §8, backlog_v2 §7).
			console.error("No se pudo salir del hogar", err);
			setLeaveError("No se pudo salir del hogar. Inténtalo de nuevo.");
			setLeavePending(false);
		}
	}

	return (
		<>
			<Drawer
				open
				onOpenChange={(open) => {
					if (!open) close();
				}}
			>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Ajustes</DrawerTitle>
					</DrawerHeader>
					<DrawerBody className="pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
						<div>
							<p className="text-13 text-muted-foreground">Hogar</p>
							<p className="text-17 font-medium">{link?.name}</p>
						</div>
						<div>
							<p className="text-13 text-muted-foreground">Código</p>
							<div className="mt-1 flex flex-wrap items-center justify-between gap-2 border border-border px-4 py-3">
								<span className="text-20 font-bold tracking-widest">
									{link?.joinCode}
								</span>
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										navigator.clipboard?.writeText(link?.joinCode ?? "");
										setCopied(true);
									}}
								>
									{copied ? "Copiado" : "Copiar"}
								</Button>
							</div>
						</div>
						<Button
							type="button"
							variant="destructive"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => setConfirmOpen(true)}
						>
							Regenerar código
						</Button>

						{link && (
							<>
								<div className="border-t border-border pt-4">
									<SupermarketsSection householdId={link.householdId} />
								</div>
								<div className="border-t border-border pt-4">
									<CategoriesSection householdId={link.householdId} />
								</div>
							</>
						)}

						<div className="border-t border-border pt-4">
							<Button
								type="button"
								variant="destructive"
								className="min-h-[var(--min-height-tap)] w-full"
								onClick={() => setLeaveOpen(true)}
							>
								Salir del hogar
							</Button>
						</div>
					</DrawerBody>
				</DrawerContent>
			</Drawer>

			<Drawer open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>¿Regenerar el código?</DrawerTitle>
						<DrawerDescription>
							El código actual deja de servir de inmediato. El otro dispositivo
							perderá el acceso al hogar hasta que vuelva a unirse con el código
							nuevo.
						</DrawerDescription>
					</DrawerHeader>
					<DrawerFooter>
						{error && (
							<p role="alert" className="text-14 text-destructive">
								{error}
							</p>
						)}
						<Button
							type="button"
							variant="destructive"
							disabled={pending}
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => void handleRegenerate()}
						>
							Regenerar y expulsar
						</Button>
						<Button
							type="button"
							variant="outline"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => setConfirmOpen(false)}
						>
							Cancelar
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

			<Drawer open={leaveOpen} onOpenChange={setLeaveOpen}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>¿Salir de {link?.name}?</DrawerTitle>
						<DrawerDescription>
							Se borran los datos de este dispositivo. El catálogo y la lista
							siguen en el servidor y en el otro dispositivo. Para volver a
							entrar necesitarás el código del hogar.
						</DrawerDescription>
					</DrawerHeader>
					<DrawerFooter>
						{unsyncedCount > 0 && (
							<p role="alert" className="text-14 text-destructive">
								Tienes {unsyncedCount}{" "}
								{unsyncedCount === 1
									? "cambio sin guardar"
									: "cambios sin guardar"}
								. Si sales ahora se pierden.
							</p>
						)}
						{leaveError && (
							<p role="alert" className="text-14 text-destructive">
								{leaveError}
							</p>
						)}
						<Button
							type="button"
							variant="destructive"
							disabled={leavePending}
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => void handleLeave()}
						>
							Salir del hogar
						</Button>
						<Button
							type="button"
							variant="outline"
							className="min-h-[var(--min-height-tap)] w-full"
							onClick={() => setLeaveOpen(false)}
						>
							Cancelar
						</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>
		</>
	);
}
