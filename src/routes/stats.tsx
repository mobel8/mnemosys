/**
 * Stats route definition. The dashboard component (which depends on the
 * heavy `recharts` library) lives in `./stats.page.tsx` and is loaded
 * lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: lazyRouteComponent(() => import("./stats.page")),
});
