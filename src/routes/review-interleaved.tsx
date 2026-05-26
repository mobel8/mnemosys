/**
 * Interleaved review route (Vague 5).
 *
 * The page component lives in `./review-interleaved.page.tsx` and is loaded
 * lazily through `lazyRouteComponent` — same pattern as the existing
 * `/ai-generate` and `/review/$deckId` routes — so the multi-deck picker
 * UI never sits in the home-route bundle.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review-interleaved",
  component: lazyRouteComponent(() => import("./review-interleaved.page")),
});
