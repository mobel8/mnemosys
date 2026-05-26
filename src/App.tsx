/**
 * Mnemosys — root component.
 *
 * Mounts the TanStack Router (imperative `createRouter` on top of the
 * `routeTree` declared in `src/routes/routeTree.ts`), TanStack Query
 * client, theme provider, toast viewport, and global error boundary.
 *
 * Also owns two cross-cutting UX features that aren't tied to a single
 * route:
 *   - The `?` shortcut → opens <ShortcutsHelpDialog>.
 *   - Two-key navigation sequences (`g h`, `g s`, `g p`) routed through
 *     a tiny inline state machine. Listening at `document` level keeps
 *     the binding alive across pages without requiring each route to
 *     wire its own hotkey.
 *
 * The smoke test asserts that the literal "Mnemosys" appears in the
 * rendered DOM. The Sidebar renders the brand text, so the test keeps
 * passing under jsdom (even though `invoke()` rejects there — the Query
 * client and Theme provider swallow those errors gracefully).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
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

/** Routes targeted by `g <key>` sequences. */
const G_SEQUENCES: Record<string, "/" | "/stats" | "/settings"> = {
  h: "/",
  s: "/stats",
  p: "/settings",
};

/** Drop the prefix if no second key is pressed within this window. */
const SEQUENCE_TIMEOUT_MS = 800;

/**
 * Should the global hotkey listener fire? Returns false when the user is
 * typing in a form control so `g`/`?` don't hijack normal text input.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export default function App() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    /** Tracks an in-progress `g` prefix waiting for the second key. */
    let pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

    function clearPrefix() {
      if (pending) {
        clearTimeout(pending.timer);
        pending = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      // Bail on modifier-combos and form inputs — we don't want to steal
      // Ctrl+R, Cmd+S, "type ? in a textarea", etc.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      // `?` toggles the cheat-sheet. On most keyboards the key is reached
      // via Shift+/, so we accept either form.
      if (e.key === "?") {
        e.preventDefault();
        clearPrefix();
        setShortcutsOpen((open) => !open);
        return;
      }

      // If we're already waiting for the second key of a `g <x>` sequence,
      // try to resolve it.
      if (pending?.key === "g") {
        const target = G_SEQUENCES[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          clearPrefix();
          void router.navigate({ to: target });
          return;
        }
        // Any other key cancels the prefix.
        clearPrefix();
        return;
      }

      // Open a `g` prefix on a bare `g` key press.
      if (e.key === "g" || e.key === "G") {
        clearPrefix();
        const timer = setTimeout(() => {
          pending = null;
        }, SEQUENCE_TIMEOUT_MS);
        pending = { key: "g", timer };
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearPrefix();
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <RouterProvider router={router} />
            <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
            <Toaster />
            <ToastViewport />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
