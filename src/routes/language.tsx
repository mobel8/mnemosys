/**
 * Language hub route definition. The hub (reading / shadowing /
 * pronunciation) lives in `./language.page.tsx` and is loaded lazily
 * through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/language",
  component: lazyRouteComponent(() => import("./language.page")),
});
