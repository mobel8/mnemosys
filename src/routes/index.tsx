/**
 * Home route definition. The actual page component lives in
 * `./index.page.tsx` and is loaded on-demand through
 * `lazyRouteComponent` so it doesn't ship in the initial JS bundle.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./index.page")),
});
