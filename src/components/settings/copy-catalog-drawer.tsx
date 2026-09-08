import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
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
import { copyCatalog } from "@/lib/household";
import { getActiveHouseholdId, getHouseholdLinks } from "@/lib/household-link";
import { deltaPull } from "@/lib/sync/delta-pull";

/**
 * Copiar a este hogar el catálogo de otro al que ya perteneces (D-051). Un solo drawer, dos puntos
 * de entrada: el estado vacío del Catálogo y una fila en Ajustes.
 *
 * `copy_catalog` es una RPC transaccional en línea (D-049), no una escritura optimista: el botón se
 * bloquea mientras resuelve. Es la misma excepción a RNF-001 que ya se permite en `join_household`.
 * Sin conexión el botón está desactivado -- no hay nada que encolar. Al volver, un delta pull
 * forzado del hogar activo trae lo copiado a la caché y las cuatro consultas repintan solas.
 */

type Phase = { kind: "form" } | { kind: "done"; productsCopied: number };

export function CopyCatalogDrawer({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const online = useSyncExternalStore(
		onlineManager.subscribe.bind(onlineManager),
		() => onlineManager.isOnline(),
		() => true,
	);

	const activeId = getActiveHouseholdId();
	const others = getHouseholdLinks().filter((h) => h.householdId !== activeId);

	const [phase, setPhase] = useState<Phase>({ kind: "form" });
	const [pickedSource, setPickedSource] = useState<string | null>(null);
	const [copyCategories, setCopyCategories] = useState(true);
	const [copySupermarkets, setCopySupermarkets] = useState(true);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Si solo hay un hogar de origen posible, va preseleccionado; con varios, hay que elegir.
	const sourceId =
		pickedSource ?? (others.length === 1 ? others[0].householdId : null);

	// Cada apertura empieza limpia: si el drawer se reabre tras una copia, no debe seguir mostrando
	// el resultado anterior ni un origen ya elegido.
	useEffect(() => {
		if (!open) return;
		setPhase({ kind: "form" });
		setPickedSource(null);
		setCopyCategories(true);
		setCopySupermarkets(true);
		setPending(false);
		setError(null);
	}, [open]);

	async function handleCopy() {
		if (!sourceId || !activeId) return;
		setPending(true);
		setError(null);
		try {
			const result = await copyCatalog(sourceId, activeId, {
				copySupermarkets,
				copyCategories,
			});
			// Trae a la caché las filas nuevas del hogar activo (D-049): el trigger del servidor les
			// puso `updated_at = now()`, así que el delta pull por cursor las recoge.
			await deltaPull(queryClient, activeId);
			setPhase({ kind: "done", productsCopied: result.productsCopied });
		} catch (err) {
			reportError(err, { op: "copy_catalog" });
			setError(toUserMessage(err));
		} finally {
			setPending(false);
		}
	}

	return (
		<Drawer open={open} onOpenChange={onOpenChange}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>Copiar catálogo</DrawerTitle>
					{phase.kind === "form" && others.length > 0 && (
						<DrawerDescription>
							Trae los productos de otro de tus hogares a este. Los que ya
							tengas no se duplican.
						</DrawerDescription>
					)}
				</DrawerHeader>

				{phase.kind === "done" ? (
					<>
						<DrawerBody className="pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
							<p className="text-17 font-medium text-foreground">
								{phase.productsCopied === 0
									? "Ese catálogo ya estaba copiado."
									: `Catálogo copiado · ${phase.productsCopied} ${
											phase.productsCopied === 1 ? "producto" : "productos"
										}`}
							</p>
						</DrawerBody>
						<DrawerFooter>
							<Button
								type="button"
								className="min-h-[var(--min-height-tap)] w-full"
								onClick={() => onOpenChange(false)}
							>
								Listo
							</Button>
						</DrawerFooter>
					</>
				) : others.length === 0 ? (
					<>
						<DrawerBody className="pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
							<p className="text-17 text-foreground">
								Primero añade el otro hogar del que quieres copiar.
							</p>
						</DrawerBody>
						<DrawerFooter>
							<Button
								type="button"
								className="min-h-[var(--min-height-tap)] w-full"
								onClick={() =>
									navigate({ to: "/onboarding", search: { add: true } })
								}
							>
								Añadir otro hogar
							</Button>
						</DrawerFooter>
					</>
				) : (
					<>
						<DrawerBody className="gap-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
							<div className="flex flex-col gap-1">
								<p className="text-13 text-muted-foreground">Copiar desde</p>
								<ul className="flex flex-col">
									{others.map((h) => (
										<li key={h.householdId} className="border-b border-border">
											<label className="flex min-h-[var(--min-height-tap)] cursor-pointer items-center gap-3 text-17">
												<input
													type="radio"
													name="copy-catalog-source"
													checked={sourceId === h.householdId}
													onChange={() => setPickedSource(h.householdId)}
													className="peer sr-only"
												/>
												<span
													aria-hidden="true"
													className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border peer-checked:border-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
												>
													<span
														className={
															sourceId === h.householdId
																? "size-2.5 rounded-full bg-foreground"
																: "size-2.5 rounded-full bg-transparent"
														}
													/>
												</span>
												{h.name}
											</label>
										</li>
									))}
								</ul>
							</div>

							<div className="flex flex-col">
								<Checkbox
									label="Copiar también las categorías"
									checked={copyCategories}
									onChange={setCopyCategories}
								/>
								<Checkbox
									label="Copiar también los supermercados"
									checked={copySupermarkets}
									onChange={setCopySupermarkets}
								/>
							</div>
						</DrawerBody>
						<DrawerFooter>
							{error && (
								<p role="alert" className="text-14 text-destructive">
									{error}
								</p>
							)}
							{!online && (
								<p className="text-14 text-alert">
									Necesitas conexión para copiar un catálogo.
								</p>
							)}
							<Button
								type="button"
								disabled={pending || !online || !sourceId}
								className="min-h-[var(--min-height-tap)] w-full"
								onClick={() => void handleCopy()}
							>
								Copiar catálogo
							</Button>
						</DrawerFooter>
					</>
				)}
			</DrawerContent>
		</Drawer>
	);
}

function Checkbox({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex min-h-[var(--min-height-tap)] cursor-pointer items-center gap-3 text-17">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="peer sr-only"
			/>
			<span
				aria-hidden="true"
				className={
					checked
						? "flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-foreground bg-foreground text-background peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
						: "flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border text-transparent peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
				}
			>
				<Check className="size-3.5" strokeWidth={2} />
			</span>
			{label}
		</label>
	);
}
