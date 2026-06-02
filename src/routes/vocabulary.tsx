/** « Vocabulaire par fréquence » route. Page in `./vocabulary.page.tsx`. */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vocabulary",
  component: lazyRouteComponent(() => import("./vocabulary.page")),
});
