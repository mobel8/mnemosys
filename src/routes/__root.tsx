import { createRootRoute, Outlet } from "@tanstack/react-router";

/**
 * Root route stub.
 * Agent B1 (Frontend Architect) will replace this with the full layout
 * (sidebar + topbar + theme provider + toaster).
 */
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="h-full w-full">
      <Outlet />
    </div>
  );
}
