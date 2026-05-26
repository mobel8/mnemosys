/**
 * Settings route definition. The settings UI lives in `./settings.page.tsx`
 * and is loaded lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./settings.page")),
});
