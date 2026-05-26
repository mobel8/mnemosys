/**
 * "Add card" route definition. The editor UI lives in
 * `./decks.$deckId.new-card.page.tsx` and is loaded lazily through
 * `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decks/$deckId/new-card",
  component: lazyRouteComponent(() => import("./decks.$deckId.new-card.page")),
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});
