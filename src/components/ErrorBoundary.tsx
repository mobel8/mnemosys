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

import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
    // Surface in the devtools console; Sentry/logging wiring lands in Session 3.
    console.error("[ErrorBoundary]", error, info.componentStack);
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
        </div>
      </div>
    );
  }
}
