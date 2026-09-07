import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Sin capa de aspecto propia de shadcn (D-038): solo los tokens ya fijados en `index.css`. Área de
 * toque de 44px (regla de interfaz de CLAUDE.md) vía `min-h-[var(--min-height-tap)]`, no un valor
 * fijo en píxeles que se desincronice del resto de la app.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex min-h-[var(--min-height-tap)] w-full rounded-[var(--radius-control)] border border-input bg-background px-3 text-17 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
