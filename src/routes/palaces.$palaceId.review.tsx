/**
 * Palace review (walk-through) route definition. UI lives in
 * `./palaces.$palaceId.review.page.tsx`, loaded lazily for the same
 * reason the editor is lazy — Three.js bundle locality.
 */

import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

/**
 * P083 — `$palaceId` is always a positive integer (the SQLite row id). A URL
 * like `/palaces/abc/review` used to parse to `NaN`, which silently propagated
 * through the IPC layer: every query gated on `Number.isFinite(palaceId)`
 * simply never ran, so the heavy Three.js walk-through hung on an eternal
 * skeleton instead of failing cleanly. We now reject non-integer /
 * non-positive ids up front with `notFound()`, which the router renders
 * through `defaultNotFoundComponent`.
 */
function parsePalaceId(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw notFound();
  }
  return value;
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/palaces/$palaceId/review",
  component: lazyRouteComponent(() => import("./palaces.$palaceId.review.page")),
  // Migrated off the deprecated `parseParams`/`stringifyParams` to `params`.
  params: {
    parse: ({ palaceId }) => ({ palaceId: parsePalaceId(palaceId) }),
    stringify: ({ palaceId }) => ({ palaceId: String(palaceId) }),
  },
});
