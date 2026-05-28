/**
 * Reading Import route (Vague 17). The page lives in `./reading.page.tsx`
 * and is loaded lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reading",
  component: lazyRouteComponent(() => import("./reading.page")),
});
