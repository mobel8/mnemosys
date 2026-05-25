import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

/**
 * Index route stub.
 *
 * Uses the imperative `createRoute(...)` API instead of `createFileRoute(...)`
 * to avoid depending on the generated `routeTree.gen.ts` (which B1 will set up
 * via `@tanstack/router-plugin` or the CLI). Once that plugin is wired, B1
 * should replace this file with the file-based route flavour.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold">Welcome to Mnemosys</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Route stub — TanStack Router not yet mounted in <code>App.tsx</code>.
      </p>
    </div>
  );
}
