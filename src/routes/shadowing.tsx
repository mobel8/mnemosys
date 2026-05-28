/**
 * Shadowing Mode route (Vague 17). The page lives in `./shadowing.page.tsx`
 * and is loaded lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shadowing",
  component: lazyRouteComponent(() => import("./shadowing.page")),
});
