/**
 * Mode Arts route (Vague 16). The gesture-timer page lives in
 * `./gesture.page.tsx` and is loaded lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gesture",
  component: lazyRouteComponent(() => import("./gesture.page")),
});
