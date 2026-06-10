/**
 * Creation hub route definition. The hub (AI generation / OCR capture /
 * frequency vocabulary / imports) lives in `./create.page.tsx` and is loaded
 * lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/create",
  component: lazyRouteComponent(() => import("./create.page")),
});
