import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { OnboardingSupermarkets } from "@/components/onboarding/onboarding-supermarkets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureAnonymousSession } from "@/lib/auth";
import { AppError, reportError } from "@/lib/errors";
import {
	createHousehold as createHouseholdRpc,
	joinHousehold as joinHouseholdRpc,
} from "@/lib/household";
import {
	requestPersistentStorage,
	setHouseholdLink,
} from "@/lib/household-link";
import { formatHouseholdInvite, shareText } from "@/lib/share";

type Step =
	| { kind: "choice" }
	| { kind: "create" }
	| { kind: "join" }
	| { kind: "created"; name: string; joinCode: string; householdId: string }
	| { kind: "supermarkets"; householdId: string };

/**
 * Primer uso (experiencia_usuario §10). Vive fuera de la barra de dos pestañas -- se guarda en
 * `router.tsx` como su propia rama, sin `AppShell` -- porque hasta que el dispositivo tenga hogar
 * no hay ni Mercado ni Catálogo que mostrar.
 *
 * `crear`/`unirse` llaman a `create_household`/`join_household` por RPC directo (`lib/household.ts`
 * documenta por qué no pasan por la mutación de sincronización). Ninguna de las dos es optimista:
 * son operaciones de una vez por dispositivo, no una de las tres frecuentes de RNF-001, así que un
 * botón deshabilitado mientras se resuelve la llamada es aceptable aquí y en ningún otro sitio.
 *
 * Modo "añadir otro hogar" (`?add=1`, D-046): la misma pantalla, pero abierta desde Ajustes teniendo
 * ya un hogar. Cambia la copia, aparece un "Cancelar" visible (en PWA a pantalla completa no hay
 * botón de atrás, experiencia_usuario §11) y al terminar recarga la app sobre el hogar nuevo, ya
 * activo (`finishLinking`), igual que "cambiar de hogar" y "salir del hogar" (D-044).
 */
export function OnboardingScreen() {
	const navigate = useNavigate();
	const add = useSearch({ from: "/onboarding", select: (s) => s.add }) ?? false;
	const [step, setStep] = useState<Step>({ kind: "choice" });
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [codeCopied, setCodeCopied] = useState(false);

	function done() {
		if (add) {
			// Recarga completa: remonta `useSyncEngine` con el hogar nuevo (D-044). `navigate` dejaría
			// vivo el motor del hogar anterior.
			window.location.assign("/");
		} else {
			navigate({ to: "/" });
		}
	}

	const cancelButton = add ? (
		<Button
			type="button"
			variant="outline"
			className="min-h-[var(--min-height-tap)] w-full text-17"
			onClick={() => navigate({ to: "/catalogo/ajustes" })}
		>
			Cancelar
		</Button>
	) : null;

	async function finishLinking(household: {
		householdId: string;
		name: string;
		joinCode: string;
	}) {
		setHouseholdLink(household);
		// Fase 0 dejó pendiente esta llamada exactamente para "el momento de vincularse a un hogar"
		// (crear o unirse): es aquí, y solo aquí, donde el dispositivo pasa a depender de que su
		// almacenamiento local sobreviva (código de hogar, cola de sincronización).
		await requestPersistentStorage();
	}

	async function handleCreate(formData: FormData) {
		const name = String(formData.get("name") ?? "").trim();
		if (!name) {
			setError("Ponle un nombre al hogar.");
			return;
		}
		setPending(true);
		setError(null);
		try {
			// Idempotente y ya intentado una vez en `main.tsx` al arrancar: si aquella llamada de
			// fondo todavía no terminó (o falló sin red y no había sesión previa), esta la repite
			// y ahora sí se espera, porque create_household exige `auth.uid()` no nulo.
			await ensureAnonymousSession();
			const household = await createHouseholdRpc(name);
			await finishLinking(household);
			setStep({
				kind: "created",
				name: household.name,
				joinCode: household.joinCode,
				householdId: household.householdId,
			});
		} catch (err) {
			reportError(err, { op: "create_household" });
			setError(
				err instanceof AppError
					? err.message
					: "No se pudo crear el hogar. Revisa tu conexión e inténtalo otra vez.",
			);
		} finally {
			setPending(false);
		}
	}

	async function handleJoin(formData: FormData) {
		const code = String(formData.get("code") ?? "")
			.trim()
			.toUpperCase();
		if (!code) {
			setError("Escribe el código del hogar.");
			return;
		}
		setPending(true);
		setError(null);
		try {
			await ensureAnonymousSession();
			const household = await joinHouseholdRpc(code);
			await finishLinking(household);
			done();
		} catch (err) {
			reportError(err, { op: "join_household" });
			setError(
				err instanceof AppError
					? err.message
					: "No se pudo unir al hogar. Revisa tu conexión e inténtalo otra vez.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<section className="flex min-h-dvh flex-col justify-center gap-6 px-4 py-6">
			{step.kind === "choice" && (
				<>
					<h1 className="text-26 font-bold wdth-75">
						{add ? "Añadir otro hogar" : "¿Empezamos?"}
					</h1>
					<div className="flex flex-col gap-3">
						<Button
							className="min-h-[var(--min-height-tap)] w-full text-17"
							onClick={() => setStep({ kind: "create" })}
						>
							Crear un hogar
						</Button>
						<Button
							variant="outline"
							className="min-h-[var(--min-height-tap)] w-full text-17"
							onClick={() => setStep({ kind: "join" })}
						>
							Unirme con un código
						</Button>
						{cancelButton}
					</div>
				</>
			)}

			{step.kind === "create" && (
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void handleCreate(new FormData(event.currentTarget));
					}}
				>
					<h1 className="text-26 font-bold wdth-75">Nombra tu hogar</h1>
					<Input
						name="name"
						placeholder="Nombre del hogar"
						autoFocus
						disabled={pending}
					/>
					{error && (
						<p role="alert" className="text-14 text-destructive">
							{error}
						</p>
					)}
					<Button
						type="submit"
						disabled={pending}
						className="min-h-[var(--min-height-tap)] w-full text-17"
					>
						Crear
					</Button>
					{cancelButton}
				</form>
			)}

			{step.kind === "join" && (
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void handleJoin(new FormData(event.currentTarget));
					}}
				>
					<h1 className="text-26 font-bold wdth-75">Código del hogar</h1>
					<Input
						name="code"
						placeholder="CÓDIGO"
						autoFocus
						disabled={pending}
						autoCapitalize="characters"
						autoCorrect="off"
						autoComplete="off"
						spellCheck={false}
						className="text-center uppercase tracking-widest"
					/>
					{error && (
						<p role="alert" className="text-14 text-destructive">
							{error}
						</p>
					)}
					<Button
						type="submit"
						disabled={pending}
						className="min-h-[var(--min-height-tap)] w-full text-17"
					>
						Unirme
					</Button>
					{cancelButton}
				</form>
			)}

			{step.kind === "created" && (
				<div className="flex flex-col gap-4">
					<h1 className="text-26 font-bold wdth-75">{step.name}</h1>
					<p className="text-14 text-muted-foreground">
						Este es el código de tu hogar. Sirve para unir el otro dispositivo y
						para recuperar el acceso si reinstalas la app. Lo encuentras siempre
						en Ajustes.
					</p>
					<div className="flex flex-wrap items-center justify-between gap-2 border border-border px-4 py-3">
						<span className="text-20 font-bold tracking-widest">
							{step.joinCode}
						</span>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									navigator.clipboard?.writeText(step.joinCode);
									setCodeCopied(true);
								}}
							>
								{codeCopied ? "Copiado" : "Copiar"}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={async () => {
									const result = await shareText(
										formatHouseholdInvite(step.joinCode),
									);
									if (result === "copied") setCodeCopied(true);
								}}
							>
								Compartir
							</Button>
						</div>
					</div>
					<Button
						type="button"
						className="min-h-[var(--min-height-tap)] w-full text-17"
						onClick={() =>
							setStep({
								kind: "supermarkets",
								householdId: step.householdId,
							})
						}
					>
						Continuar
					</Button>
				</div>
			)}

			{step.kind === "supermarkets" && (
				<OnboardingSupermarkets householdId={step.householdId} onDone={done} />
			)}
		</section>
	);
}
