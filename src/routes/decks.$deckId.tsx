/**
 * Deck detail route definition. The deck UI lives in
 * `./decks.$deckId.page.tsx` and is loaded lazily through
 * `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decks/$deckId",
  component: lazyRouteComponent(() => import("./decks.$deckId.page")),
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});
