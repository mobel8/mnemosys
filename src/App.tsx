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
import { createRouter, Link, RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { AlertTriangle, Compass, Home, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { Button } from "@/components/ui/button";
import { ToastProvider, ToastViewport } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { scheduleNotifications } from "@/lib/notifications";
import { usePlans } from "@/lib/queries";
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

/**
 * P083 — rendered when a route throws `notFound()` (e.g. an `/decks/abc` URL
 * whose id parser rejects the non-integer param) or when no route matches the
 * URL at all. Without this the `notFound()` thrown by the `$deckId` / `$palaceId`
 * parsers fell through to an empty `<main>`. Lives inside the root layout's
 * `<Outlet />`, so it's a content-area panel rather than a full-screen takeover.
 */
function RouteNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Compass className="h-8 w-8" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Page introuvable</h1>
        <p className="text-sm text-muted-foreground">
          Cette page n'existe pas ou le lien utilisé n'est plus valide.
        </p>
      </div>
      <Button asChild>
        <Link to="/">
          <Home className="h-4 w-4" />
          Retour à l'accueil
        </Link>
      </Button>
    </div>
  );
}

/**
 * P083 — rendered when a route loader or component throws during navigation.
 * The app-level <ErrorBoundary> still wraps everything as a last resort, but
 * this keeps a route-scoped failure contained to the content area (the sidebar
 * and topbar stay usable) and offers an in-place retry.
 */
function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-8 w-8" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Une erreur est survenue</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "Le chargement de cette page a échoué."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RefreshCw className="h-4 w-4" />
          Réessayer
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">
            <Home className="h-4 w-4" />
            Retour à l'accueil
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * P083 — shown while a lazy route chunk downloads (the Three.js palace bundle
 * and the OCR/capture bundle are heavy). Replaces the previous blank `<main>`
 * with an explicit loading affordance so slow navigations don't look frozen.
 */
function RoutePending() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Chargement…</p>
    </div>
  );
}

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: RouteNotFound,
  defaultErrorComponent: RouteError,
  defaultPendingComponent: RoutePending,
});

// Hand TanStack Router the inferred routeTree type so `<Link to="...">`
// stays type-safe across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Routes targeted by `g <key>` sequences — one per nav destination. */
const G_SEQUENCES: Record<
  string,
  "/" | "/review-all" | "/create" | "/language" | "/stats" | "/settings"
> = {
  h: "/",
  r: "/review-all",
  c: "/create",
  l: "/language",
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
      // via Shift+/, so we accept either form. Review routes own their own
      // session-scoped help dialog — bail there so a single `?` can't open
      // two stacked overlays (audit finding).
      if (e.key === "?") {
        if (window.location.pathname.startsWith("/review")) return;
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
      {/* P029: respect prefers-reduced-motion globally for all framer-motion. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <RouterProvider router={router} />
              <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
              <PlannerNotificationsShell />
              <Toaster />
              <ToastViewport />
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

/**
 * Re-arms local reminders for time-based study plans (Vague 21) whenever the
 * plan list changes. `scheduleNotifications` is a no-op outside Tauri, so this
 * is inert under jsdom/tests and renders nothing.
 */
function PlannerNotificationsShell() {
  const plans = usePlans();
  const data = plans.data;
  useEffect(() => {
    if (!data) return;
    void scheduleNotifications(data);
  }, [data]);
  return null;
}
