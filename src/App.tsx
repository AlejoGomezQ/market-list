import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { UpdateBanner } from "@/components/update-banner";
import { persistOptions, queryClient } from "@/lib/query-client";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { router } from "@/router";

/**
 * `PersistQueryClientProvider` hidrata la caché desde IndexedDB en un efecto tras montar, así que
 * el registro de `setMutationDefaults` (dentro de `createSyncQueryClient`, ya ejecutado al importar
 * `queryClient` arriba) siempre ocurre antes de cualquier hidratación (CLAUDE.md, regla no
 * negociable de sincronización #4). El montaje no depende de que Supabase esté configurado: la
 * interfaz local-first sigue funcionando sin red y sin proyecto remoto (`src/lib/supabase.ts`
 * documenta y avisa el caso, `AppShell` lo muestra).
 */
function App() {
	// Publica el área visible como --vvh / --vv-offset-top para que los drawers no queden
	// detrás del teclado de iOS. Aquí, en la raíz, cubre también los drawers de onboarding.
	useVisualViewport();

	return (
		<PersistQueryClientProvider
			client={queryClient}
			persistOptions={persistOptions}
		>
			<UpdateBanner />
			<RouterProvider router={router} />
		</PersistQueryClientProvider>
	);
}

export default App;
