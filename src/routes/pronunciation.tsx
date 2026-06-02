/** « Prononciation » route. Page in `./pronunciation.page.tsx`. */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pronunciation",
  component: lazyRouteComponent(() => import("./pronunciation.page")),
});
