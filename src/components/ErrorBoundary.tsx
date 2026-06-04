/**
 * Global React error boundary.
 *
 * Wraps the `<RouterProvider />` in `App.tsx` so any uncaught render-time
 * error (TanStack Router won't catch them either) ends up in a friendly
 * fallback UI instead of a blank screen. Offers two recovery paths:
 *   - "Réessayer" : resets the boundary (re-runs the failed render tree).
 *   - "Retour à l'accueil" : hard-navigates to `/` and resets.
 *
 * Implemented as a class component because React 19's hook-based APIs still
 * don't expose `componentDidCatch` / `getDerivedStateFromError`.
 */

import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, FileText, Home, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * P091 — best-effort persistence of a caught render error to the backend log
 * file (`tauri-plugin-log`, rotating file in `app_log_dir`). The `log_frontend_error`
 * command writes one timestamped entry. Failures (running outside Tauri, or the
 * command not yet registered) are swallowed: a logging hiccup must never mask
 * the original error nor break the fallback UI.
 */
async function persistError(error: Error, componentStack: string | null): Promise<void> {
  try {
    await invoke("log_frontend_error", {
      message: error.message,
      stack: error.stack ?? null,
      componentStack: componentStack ?? null,
    });
  } catch {
    // No-op: outside Tauri, or command unavailable.
  }
}

/** P091 — reveal the rotating log directory in the OS file manager. */
async function openLogDir(): Promise<void> {
  try {
    await invoke("open_log_dir");
  } catch {
    // No-op: outside Tauri, or command unavailable.
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional override of the default fallback UI. */
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in the devtools console for live debugging…
    console.error("[ErrorBoundary]", error, info.componentStack);
    // …and persist to the rotating backend log so a crash on a user's machine
    // leaves a trace (P091). Fire-and-forget; never throws.
    void persistError(error, info.componentStack ?? null);
  }

  reset = () => {
    this.setState({ error: null });
  };

  goHome = () => {
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
    this.reset();
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Une erreur est survenue</h1>
          <p className="text-sm text-muted-foreground">
            {error.message || "Une erreur inattendue a interrompu l'application."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={this.reset}>
            <RefreshCw className="h-4 w-4" />
            Réessayer
          </Button>
          <Button variant="outline" onClick={this.goHome}>
            <Home className="h-4 w-4" />
            Retourner à l'accueil
          </Button>
          {/* P091 — let the user surface the local log file to attach to a
              bug report. No data ever leaves the machine automatically. */}
          <Button variant="ghost" onClick={() => void openLogDir()}>
            <FileText className="h-4 w-4" />
            Ouvrir le dossier des logs
          </Button>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          Les détails de l'erreur sont enregistrés localement (aucun envoi automatique). Tu peux
          ouvrir le dossier des logs pour les joindre à un signalement.
        </p>
      </div>
    );
  }
}
