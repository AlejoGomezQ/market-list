import { X } from "lucide-react";
import type * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

function Drawer({
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
	return (
		// `repositionInputs={false}`: vaul, por defecto, sube el drawer para que el input enfocado no
		// quede tapado por el teclado de iOS. Ese trabajo ya lo hace nuestro CSS a partir de --vvh
		// (index.css, regla de `[data-slot="drawer-content"]`); si vaul también lo hace, el drawer se
		// levanta dos veces y queda flotando con espacio muerto debajo.
		<DrawerPrimitive.Root
			data-slot="drawer"
			repositionInputs={false}
			{...props}
		/>
	);
}

function DrawerTrigger({
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
	return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
	return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
	return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
	className,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
	return (
		<DrawerPrimitive.Overlay
			data-slot="drawer-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
				className,
			)}
			{...props}
		/>
	);
}

function DrawerContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
	return (
		<DrawerPortal data-slot="drawer-portal">
			<DrawerOverlay />
			{/*
			 * El drawer inferior fija su `bottom` y su `max-height` en index.css a partir de
			 * --vvh / --vv-offset-top (use-visual-viewport.ts): con el teclado de iOS abierto se
			 * levanta por encima de él en vez de quedar detrás. Sin teclado equivale a
			 * `bottom: 0` + `max-height: 80vh`.
			 */}
			<DrawerPrimitive.Content
				data-slot="drawer-content"
				className={cn(
					"group/drawer-content fixed z-50 flex h-auto flex-col overflow-hidden bg-popover text-sm text-popover-foreground data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:rounded-r-xl data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:rounded-l-xl data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-xl data-[vaul-drawer-direction=top]:border-b data-[vaul-drawer-direction=left]:sm:max-w-sm data-[vaul-drawer-direction=right]:sm:max-w-sm",
					className,
				)}
				{...props}
			>
				<div className="mx-auto mt-3 hidden h-1 w-[100px] shrink-0 rounded-full bg-border group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
				{children}
			</DrawerPrimitive.Content>
		</DrawerPortal>
	);
}

/**
 * Cabecera fija del drawer. Lleva su propia X de cierre (experiencia_usuario §6, y en PWA a pantalla
 * completa no hay botón de atrás): `DrawerClose` cierra el `Drawer` más cercano sin necesitar un
 * handler, así que sirve igual para el drawer principal y para los anidados. El asa de arrastre
 * sigue estando (la pinta `DrawerContent`).
 */
function DrawerHeader({
	className,
	children,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="drawer-header"
			className={cn(
				"relative flex shrink-0 flex-col gap-1 px-5 pt-3 pb-0 text-center",
				className,
			)}
			{...props}
		>
			{children}
			<DrawerClose
				aria-label="Cerrar"
				className="absolute top-2 right-3 flex size-11 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<X aria-hidden="true" className="size-5" strokeWidth={1.75} />
			</DrawerClose>
		</div>
	);
}

/**
 * Cuerpo scrolleable del drawer: header y footer quedan fijos, solo esto se desplaza (bug del
 * drawer de producto en iPhone, donde "Guardar" se iba de la pantalla al expandir "Marca y
 * categoría"). `touch-pan-y` reautoriza el paneo vertical dentro del subárbol: vaul fija
 * `touch-action: none` en la raíz de `DrawerContent` para leer el arrastre de cierre.
 *
 * `min-h-0` + `shrink` (sin `flex-1`): el cuerpo se encoge y scrollea cuando el contenido pasa del
 * tope de `DrawerContent`, pero NO crece para llenarlo. Con `flex-1` (`flex-basis: 0`) WebKit en
 * iOS resuelve la altura `auto` de `DrawerContent` (que es `position: fixed` con `bottom` fijado y
 * `top: auto`) contra el bloque contenedor entero en vez de contra el contenido, y el drawer se
 * estira hasta el tope con una franja negra vacía debajo de un contenido corto (drawer de Ajustes).
 * Sin el hijo `flex-basis: 0`, la altura `auto` vuelve a ser la del contenido.
 */
function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="drawer-body"
			className={cn(
				"flex min-h-0 shrink flex-col gap-[22px] touch-pan-y overflow-y-auto overscroll-contain px-5 pt-[26px] pb-5",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Pie fijo con las acciones. El `pb` resta la altura del teclado al safe-area: en iOS
 * `env(safe-area-inset-bottom)` sigue valiendo ~34px con el teclado abierto aunque esa franja quede
 * tapada, así que cuando el drawer está apoyado sobre el teclado (`--drawer-kb-height` > 0, ver
 * index.css) ese respiro sobra y se descuenta. Sin teclado, `--drawer-kb-height` es 0 y el pie
 * respeta el safe-area entero. Los botones del pie miden 50px de alto (regla en index.css).
 */
function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="drawer-footer"
			className={cn(
				"mt-auto flex shrink-0 flex-col gap-2.5 px-5 pt-[22px] pb-[calc(1rem+max(0px,env(safe-area-inset-bottom,0px)-var(--drawer-kb-height,0px)))]",
				className,
			)}
			{...props}
		/>
	);
}

function DrawerTitle({
	className,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
	return (
		<DrawerPrimitive.Title
			data-slot="drawer-title"
			className={cn(
				"font-heading text-20 font-semibold text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function DrawerDescription({
	className,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
	return (
		<DrawerPrimitive.Description
			data-slot="drawer-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Drawer,
	DrawerBody,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerOverlay,
	DrawerPortal,
	DrawerTitle,
	DrawerTrigger,
};
