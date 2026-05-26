/**
 * Mnemosys — root component.
 *
 * Mounts the TanStack Router (imperative `createRouter` on top of the
 * `routeTree` declared in `src/routes/routeTree.ts`), TanStack Query
 * client, theme provider, and toast viewport. Once this file is loaded by
 * `main.tsx`, every feature page lives under a route and is reachable via
 * `<Link to="...">`.
 *
 * Note: the smoke test asserts that the literal "Mnemosys" appears in the
 * rendered DOM. The Sidebar renders the brand text, so the test keeps
 * passing under jsdom (even though `invoke()` rejects there — the Query
 * client and Theme provider swallow those errors gracefully).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ToastProvider, ToastViewport } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/lib/theme";
import { routeTree } from "@/routes/routeTree";

// One QueryClient per app lifetime. Tauri calls are local IPC so retries
// don't help and a 30s stale time avoids needless re-fetches on tab focus.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Hand TanStack Router the inferred routeTree type so `<Link to="...">`
// stays type-safe across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <Toaster />
          <ToastViewport />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
