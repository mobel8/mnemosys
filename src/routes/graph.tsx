/**
 * Knowledge Graph route definition (Vague 11). The page component lives in
 * `./graph.page.tsx` and is loaded lazily through `lazyRouteComponent` to
 * keep the SVG layout code out of the initial bundle.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graph",
  component: lazyRouteComponent(() => import("./graph.page")),
});
