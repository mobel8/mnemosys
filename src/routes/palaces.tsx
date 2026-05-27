/**
 * Memory Palaces index route. The dashboard component lives in
 * `./palaces.page.tsx` and is loaded lazily via `lazyRouteComponent`
 * so the Three.js bundle stays out of the initial bundle of every other
 * route — only learners who tap into the palace UI pay for R3F.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/palaces",
  component: lazyRouteComponent(() => import("./palaces.page")),
});
