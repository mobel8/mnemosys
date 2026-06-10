/**
 * Global review route definition — the « Réviser » nav entry. Starts a
 * session over every due card across all decks (interleaved order, daily
 * quotas respected). Lives in `./review-all.page.tsx`, loaded lazily.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review-all",
  component: lazyRouteComponent(() => import("./review-all.page")),
});
