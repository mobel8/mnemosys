/**
 * « Capture → cartes » route. The page lives in `./capture.page.tsx` and is
 * loaded lazily (it pulls in the tesseract.js OCR engine on demand).
 */

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/capture",
  component: lazyRouteComponent(() => import("./capture.page")),
});
