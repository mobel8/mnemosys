/**
 * AI card generation route definition. The page component lives in
 * `./ai-generate.page.tsx` and is loaded lazily through
 * `lazyRouteComponent` so the Claude-IPC wiring + editor UI never sits in
 * the home-route bundle.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai-generate",
  component: lazyRouteComponent(() => import("./ai-generate.page")),
});
