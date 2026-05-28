/**
 * Study Planner route (Vague 21 — Implementation Intentions). The page lives
 * in `./planner.page.tsx` and is loaded lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/planner",
  component: lazyRouteComponent(() => import("./planner.page")),
});
