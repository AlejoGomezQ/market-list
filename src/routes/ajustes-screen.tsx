import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
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
import { reportError, toUserMessage } from "@/lib/errors";
import {
	leaveHousehold,
	listHouseholds,
	regenerateHouseholdCode,
} from "@/lib/household";
import {
	addHouseholdLink,
	clearHouseholdLink,
	getActiveHouseholdId,
	getHouseholdLink,
	getHouseholdLinks,
	removeHouseholdLink,
	setActiveHousehold,
	updateStoredJoinCode,
} from "@/lib/household-link";
import {
	clearHouseholdSyncState,
	clearPersistedSyncState,
} from "@/lib/query-client";
import { useSyncStatus } from "@/lib/sync/use-sync-status";

/**
 * Ajustes como drawer desde abajo (D-023), no como pantalla propia -- cuelga de `/catalogo` en
 * `router.tsx`. Cerrarlo (deslizar, tocar fuera, o el botón) es simplemente volver a `/catalogo`:
 * es la "salida visible" que exige experiencia_usuario §11 en ausencia de botón de atrás.
 *
 * Primera sección: "Hogar activo" (D-045). Un dispositivo puede seguir varios hogares (D-043); esta
 * es la única superficie desde la que se cambia cuál está activo. Cambiar de hogar recarga la app
 * (`window.location.assign`), igual que salir del hogar y regenerar el código (D-044): es la forma
 * segura de remontar el motor de sincronización sobre el hogar nuevo.
 *
 * El resto de secciones ("Hogar", "Código", supermercados, categorías, salir) muestran y tocan
 * siempre el **hogar activo** -- `getHouseholdLink()` ya devuelve ese.
 */
export function AjustesDrawer() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const sync = useSyncStatus(queryClient);
	const [links, setLinks] = useState(() => getHouseholdLinks());
	const [link, setLink] = useState(() => getHouseholdLink());
	const [prunedNotice, setPrunedNotice] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [leaveOpen, setLeaveOpen] = useState(false);
	const [leavePending, setLeavePending] = useState(false);
	const [leaveError, setLeaveError] = useState<string | null>(null);

	const activeId = link?.householdId ?? null;

	// Cambios que aún no llegaron al servidor: pausados por falta de red, o en cuarentena (rechazo
	// permanente, que nunca se resuelve solo). Salir vacía IndexedDB, así que estos se pierden.
	const unsyncedCount =
		sync.kind === "offline"
			? sync.pendingCount
			: sync.kind === "quarantined"
				? sync.count
				: 0;

	/**
	 * Reconciliación con `list_households()` al abrir Ajustes (D-053, §8.3 punto 5): el servidor es
	 * la verdad de a qué hogares perteneces. Un hogar del vínculo local que ya no esté en la
	 * respuesta = te expulsaron (D-040/D-048) o dejó de existir -> se poda del vínculo y se tira su
	 * caché. Best-effort: si la RPC falla (sin red), nos quedamos con lo local.
	 */
	useEffect(() => {
		let cancelled = false;
		const wasActiveId = getActiveHouseholdId();
		listHouseholds()
			.then((server) => {
				if (cancelled) return;
				const local = getHouseholdLinks();
				const serverIds = new Set(server.map((h) => h.householdId));
				const pruned = local.filter((h) => !serverIds.has(h.householdId));
				for (const h of pruned) {
					removeHouseholdLink(h.householdId);
					void clearHouseholdSyncState(h.householdId, queryClient);
				}
				// Nombre/código al día para los que siguen (no cambia el activo).
				for (const s of server) {
					if (local.some((h) => h.householdId === s.householdId)) {
						addHouseholdLink(s);
					}
				}
				if (pruned.length > 0) {
					setPrunedNotice(
						`Ya no perteneces a ${pruned
							.map((h) => `«${h.name}»`)
							.join(", ")}.`,
					);
					if (pruned.some((h) => h.householdId === wasActiveId)) {
						// El hogar activo ya no es tuyo: recarga. Si quedan otros, `removeHouseholdLink`
						// ya promovió uno; si no, el guardia de `router.tsx` lleva a onboarding.
						window.location.assign("/");
						return;
					}
				}
				setLinks(getHouseholdLinks());
				setLink(getHouseholdLink());
			})
			.catch((err) => {
				reportError(err, { op: "list_households" });
			});
		return () => {
			cancelled = true;
		};
	}, [queryClient]);

	function close() {
		navigate({ to: "/catalogo" });
	}

	function switchHousehold(id: string) {
		if (id === activeId) return;
		setActiveHousehold(id);
		window.location.assign("/");
	}

	async function handleRegenerate() {
		setPending(true);
		setError(null);
		try {
			const joinCode = await regenerateHouseholdCode(activeId ?? undefined);
			updateStoredJoinCode(joinCode);
			setLink((current) => (current ? { ...current, joinCode } : current));
			setLinks(getHouseholdLinks());
			setConfirmOpen(false);
		} catch (err) {
			reportError(err, { op: "regenerate_household_code" });
			setError(toUserMessage(err));
		} finally {
			setPending(false);
		}
	}

	async function handleLeave() {
		setLeavePending(true);
		setLeaveError(null);
		try {
			const leftId = getActiveHouseholdId();
			await leaveHousehold(leftId ?? undefined);
			if (leftId && getHouseholdLinks().length > 1) {
				// D-047: quedan otros hogares -> limpieza selectiva, se conserva la caché del resto.
				removeHouseholdLink(leftId);
				await clearHouseholdSyncState(leftId, queryClient);
			} else {
				// Último hogar -> se tira todo y el guardia lleva a onboarding (D-014).
				clearHouseholdLink();
				await clearPersistedSyncState();
			}
			// Recarga completa en vez de navigate(): es la única forma segura de tirar el QueryClient
			// en memoria, el motor de sync (Realtime + delta pull de AppShell) y la suscripción de la
			// cola de salida (main.tsx). No se restablece leavePending: la página se va.
			window.location.assign("/");
		} catch (err) {
			// El texto crudo de la excepción no le sirve a nadie de pie en un pasillo: el detalle va
			// a Sentry, el usuario ve una frase (identidad_visual §8, backlog_v2 §7).
			reportError(err, { op: "leave_household" });
			setLeaveError(toUserMessage(err));
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
						<section className="flex flex-col gap-2">
							<p className="text-13 text-muted-foreground">Hogar activo</p>
							<ul className="flex flex-col">
								{links.map((h) => {
									const isActive = h.householdId === activeId;
									return (
										<li key={h.householdId} className="border-b border-border">
											<button
												type="button"
												aria-current={isActive ? "true" : undefined}
												onClick={() => switchHousehold(h.householdId)}
												className="flex min-h-[var(--min-height-tap)] w-full items-center justify-between gap-3 text-left text-17"
											>
												<span className={isActive ? "font-medium" : undefined}>
													{h.name}
												</span>
												{isActive && (
													<span className="flex shrink-0 items-center gap-1 text-13 text-muted-foreground">
														Activo
														<Check
															aria-hidden="true"
															className="size-4"
															strokeWidth={1.75}
														/>
													</span>
												)}
											</button>
										</li>
									);
								})}
							</ul>
							{prunedNotice && (
								<p role="alert" className="text-14 text-alert">
									{prunedNotice}
								</p>
							)}
							<Button
								type="button"
								variant="outline"
								onClick={() =>
									navigate({ to: "/onboarding", search: { add: true } })
								}
								className="min-h-[var(--min-height-tap)] self-start"
							>
								Añadir otro hogar
							</Button>
						</section>

						<div className="border-t border-border pt-4">
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
								Salir de este hogar
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
							Se borran los datos de este hogar en este dispositivo. El catálogo
							y la lista siguen en el servidor y en el otro dispositivo. Para
							volver a entrar necesitarás el código del hogar.
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
							Salir de este hogar
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
