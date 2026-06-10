import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

/**
 * Root route — renders the persistent app shell (sidebar + topbar) and an
 * `<Outlet />` for the active child route. The router provider lives in
 * `App.tsx`; this file only describes the layout.
 *
 * v0.11 — review routes (`/review/$deckId`, `/review-all`) render WITHOUT the
 * shell: a session is a focused, fullscreen activity. The sidebar competing
 * for attention during reviews was one of the audit's core UX findings.
 */
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const isFullscreen = useRouterState({
    select: (s) => s.location.pathname.startsWith("/review"),
  });

  if (isFullscreen) {
    return (
      <div className="h-full w-full bg-background text-foreground">
        <main className="h-full min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
