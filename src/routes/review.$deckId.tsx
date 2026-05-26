/**
 * Review session route definition. The session UI lives in
 * `./review.$deckId.page.tsx` and is loaded lazily through
 * `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/$deckId",
  component: lazyRouteComponent(() => import("./review.$deckId.page")),
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});
