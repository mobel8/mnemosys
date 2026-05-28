/**
 * Imperative TanStack Router route tree.
 *
 * We don't use `@tanstack/router-plugin`'s file-based codegen (would require
 * a vite plugin install + dev-server restart loop that other agents haven't
 * validated yet). Instead, each route module exports a `Route` built with
 * `createRoute(...)` and this file wires them under the root.
 *
 * Adding a route:
 *   1. Create `src/routes/<segment>.tsx` exporting a `Route`.
 *   2. Import it here and append to the `addChildren([...])` array.
 *   3. Add type augmentation for `FileRoutesByPath` if you want full
 *      typed `Link` targets (TanStack Router v1 picks them up automatically
 *      when the Route is referenced by `getParentRoute`).
 */

import { Route as rootRoute } from "./__root";
import { Route as achievementsRoute } from "./achievements";
import { Route as aiGenerateRoute } from "./ai-generate";
import { Route as decksDeckIdRoute } from "./decks.$deckId";
import { Route as decksDeckIdNewCardRoute } from "./decks.$deckId.new-card";
import { Route as gestureRoute } from "./gesture";
import { Route as graphRoute } from "./graph";
import { Route as indexRoute } from "./index";
import { Route as mnemonicsRoute } from "./mnemonics";
import { Route as musicRoute } from "./music";
import { Route as palacesRoute } from "./palaces";
import { Route as palacesPalaceIdRoute } from "./palaces.$palaceId";
import { Route as palacesPalaceIdReviewRoute } from "./palaces.$palaceId.review";
import { Route as plannerRoute } from "./planner";
import { Route as readingRoute } from "./reading";
import { Route as reviewDeckIdRoute } from "./review.$deckId";
import { Route as reviewInterleavedRoute } from "./review-interleaved";
import { Route as settingsRoute } from "./settings";
import { Route as shadowingRoute } from "./shadowing";
import { Route as statsRoute } from "./stats";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  decksDeckIdRoute,
  decksDeckIdNewCardRoute,
  reviewDeckIdRoute,
  reviewInterleavedRoute,
  aiGenerateRoute,
  palacesRoute,
  palacesPalaceIdRoute,
  palacesPalaceIdReviewRoute,
  statsRoute,
  graphRoute,
  achievementsRoute,
  musicRoute,
  gestureRoute,
  shadowingRoute,
  readingRoute,
  plannerRoute,
  mnemonicsRoute,
  settingsRoute,
]);
