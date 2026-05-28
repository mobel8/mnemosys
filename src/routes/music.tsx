/**
 * Mode Musique route (Vague 16). The page (metronome + ear training) lives in
 * `./music.page.tsx` and is loaded lazily through `lazyRouteComponent`,
 * keeping the Web-Audio tooling out of the initial bundle.
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/music",
  component: lazyRouteComponent(() => import("./music.page")),
});
