import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupermarketMutations } from "@/lib/mutations/supermarkets";
import { nextPosition, supermarketColorClass } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import type { Supermarket } from "@/schemas/domain";
import { nameFieldSchema } from "@/schemas/forms";

/**
 * Paso de onboarding solo para quien crea el hogar: `create_household` no siembra supermercados
 * (son de cada hogar, no un default) y sin ellos el Mercado arranca vacío sin sitio obvio donde
 * añadirlos. Quien se une con código no lo ve: ese hogar ya trae los supermercados del otro
 * dispositivo por delta pull.
 *
 * Es saltable: el supermercado es opcional (D-002, grupo "Sin asignar") y siempre se pueden crear
 * luego en Ajustes. Usa la mutación normal de supermercados (optimista, sin spinner), la misma que
 * `SupermarketsSection`.
 */
export function OnboardingSupermarkets({
	householdId,
	onDone,
}: {
	householdId: string;
	onDone: () => void;
}) {
	const queryClient = useQueryClient();
	const mutations = useSupermarketMutations(householdId, queryClient);
	const [added, setAdded] = useState<Supermarket[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	function add() {
		const parsed = nameFieldSchema.safeParse(name);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Ponle un nombre.");
			return;
		}
		const row = mutations.create(parsed.data, nextPosition(added));
		setAdded((rows) => [...rows, row]);
		setName("");
		setError(null);
	}

	return (
		<div className="flex flex-col gap-4">
			<h1 className="text-26 font-bold wdth-75">
				¿En qué supermercados compras?
			</h1>
			<p className="text-14 text-muted-foreground">
				Añade los de tu hogar para agrupar la lista. Puedes cambiarlos luego en
				Ajustes.
			</p>

			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					add();
				}}
			>
				<Input
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						setError(null);
					}}
					placeholder="Nombre del supermercado"
					autoFocus
				/>
				<Button type="submit" variant="outline" className="shrink-0">
					Añadir
				</Button>
			</form>
			{error && (
				<p role="alert" className="text-14 text-destructive">
					{error}
				</p>
			)}

			{added.length > 0 && (
				<ul className="flex flex-col">
					{added.map((supermarket) => (
						<li
							key={supermarket.id}
							className="flex min-h-[var(--min-height-tap)] items-center gap-2 border-b border-border text-17"
						>
							<span
								aria-hidden="true"
								className={cn(
									"size-3 shrink-0 rounded-full",
									supermarketColorClass(supermarket.position),
								)}
							/>
							{supermarket.name}
						</li>
					))}
				</ul>
			)}

			<Button
				type="button"
				className="min-h-[var(--min-height-tap)] w-full text-17"
				onClick={onDone}
			>
				{added.length > 0 ? "Listo" : "Ahora no"}
			</Button>
		</div>
	);
}
