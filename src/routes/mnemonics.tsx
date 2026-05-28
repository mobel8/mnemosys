/**
 * Mnemonics route (Vague 21 — Major System helper). The page lives in
 * `./mnemonics.page.tsx` and is loaded lazily through `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mnemonics",
  component: lazyRouteComponent(() => import("./mnemonics.page")),
});
