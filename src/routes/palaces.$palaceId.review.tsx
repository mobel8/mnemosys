/**
 * Palace review (walk-through) route definition. UI lives in
 * `./palaces.$palaceId.review.page.tsx`, loaded lazily for the same
 * reason the editor is lazy — Three.js bundle locality.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/palaces/$palaceId/review",
  component: lazyRouteComponent(() => import("./palaces.$palaceId.review.page")),
  parseParams: ({ palaceId }) => ({ palaceId: Number(palaceId) }),
});
