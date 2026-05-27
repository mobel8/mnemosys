/**
 * Palace builder route definition. The UI lives in
 * `./palaces.$palaceId.page.tsx` and loads lazily so the Three.js bundle
 * only ships to learners who actually open a palace.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/palaces/$palaceId",
  component: lazyRouteComponent(() => import("./palaces.$palaceId.page")),
  parseParams: ({ palaceId }) => ({ palaceId: Number(palaceId) }),
});
