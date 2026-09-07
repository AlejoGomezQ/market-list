import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { persistOptions, queryClient } from "@/lib/query-client";
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
	return (
		<PersistQueryClientProvider
			client={queryClient}
			persistOptions={persistOptions}
		>
			<RouterProvider router={router} />
		</PersistQueryClientProvider>
	);
}

export default App;
