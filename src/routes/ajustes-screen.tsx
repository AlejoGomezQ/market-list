import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { regenerateHouseholdCode } from "@/lib/household";
import { getHouseholdLink, updateStoredJoinCode } from "@/lib/household-link";

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
	const [link, setLink] = useState(() => getHouseholdLink());
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

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
					<div className="flex flex-col gap-4 px-4 pb-6">
						<div>
							<p className="text-13 text-muted-foreground">Hogar</p>
							<p className="text-17 font-medium">{link?.name}</p>
						</div>
						<div>
							<p className="text-13 text-muted-foreground">Código</p>
							<div className="mt-1 flex items-center justify-between border border-border px-4 py-3">
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
					</div>
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
		</>
	);
}
