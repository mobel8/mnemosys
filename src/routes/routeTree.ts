/**
 * Imperative TanStack Router route tree.
 *
 * We don't use `@tanstack/router-plugin`'s file-based codegen (would require
 * a vite plugin install + dev-server restart loop that other agents haven't
 * validated yet). Instead, each route module exports a `Route` built with
 * `createRoute(...)` and this file wires them under the root.
 *
 * v0.11 route map (6 nav destinations + deck/review details):
 *   /                      — home (decks + today hero)
 *   /review-all            — global due session (all decks, interleaved)
 *   /review/$deckId        — per-deck session
 *   /create                — creation hub (AI / capture / vocabulary / imports)
 *   /language              — language hub (reading / shadowing / pronunciation)
 *   /stats                 — stats hub (overview / calibration / succès / graphe)
 *   /settings              — settings (tabbed)
 *   /decks/$deckId[/new-card]
 */

import { Route as rootRoute } from "./__root";
import { Route as createRouteEntry } from "./create";
import { Route as decksDeckIdRoute } from "./decks.$deckId";
import { Route as decksDeckIdNewCardRoute } from "./decks.$deckId.new-card";
import { Route as indexRoute } from "./index";
import { Route as languageRoute } from "./language";
import { Route as reviewDeckIdRoute } from "./review.$deckId";
import { Route as reviewAllRoute } from "./review-all";
import { Route as settingsRoute } from "./settings";
import { Route as statsRoute } from "./stats";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  decksDeckIdRoute,
  decksDeckIdNewCardRoute,
  reviewDeckIdRoute,
  reviewAllRoute,
  createRouteEntry,
  languageRoute,
  statsRoute,
  settingsRoute,
]);
