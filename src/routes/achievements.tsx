/**
 * Achievements route definition. The dashboard component lives in
 * `./achievements.page.tsx` and is loaded lazily via `lazyRouteComponent`
 * so the achievements catalog stays out of the initial bundle.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/achievements",
  component: lazyRouteComponent(() => import("./achievements.page")),
});
