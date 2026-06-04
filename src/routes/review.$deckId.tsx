/**
 * Review session route definition. The session UI lives in
 * `./review.$deckId.page.tsx` and is loaded lazily through
 * `lazyRouteComponent`.
 */

import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

/**
 * P083 — `$deckId` is always a positive integer (the SQLite row id). A URL like
 * `/review/abc` used to parse to `NaN`, which silently propagated through the
 * IPC layer: every query gated on `Number.isFinite(deckId)` simply never ran,
 * so the page hung on an eternal skeleton instead of failing cleanly. We now
 * reject non-integer / non-positive ids up front with `notFound()`, which the
 * router renders through `defaultNotFoundComponent`.
 */
function parseDeckId(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw notFound();
  }
  return value;
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/$deckId",
  component: lazyRouteComponent(() => import("./review.$deckId.page")),
  // Migrated off the deprecated `parseParams`/`stringifyParams` to `params`.
  params: {
    parse: ({ deckId }) => ({ deckId: parseDeckId(deckId) }),
    stringify: ({ deckId }) => ({ deckId: String(deckId) }),
  },
});
