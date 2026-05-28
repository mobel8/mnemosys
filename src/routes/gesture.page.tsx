/**
 * Mode Arts page (Vague 16). A gesture-drawing timer over the reused V7
 * SketchCanvas. Pure frontend (Web Audio + Canvas), loaded lazily via
 * `lazyRouteComponent`.
 */

import { Palette } from "lucide-react";
import { GestureTimer } from "@/components/art/GestureTimer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function GesturePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Palette className="h-6 w-6" /> Gesture drawing
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Poses chronométrées pour capturer le mouvement et les proportions sans t'attarder sur le
          détail.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Timer de gesture</CardTitle>
          <CardDescription>
            Choisis une durée ou lance le ladder (30 s ×5 → 1 min ×3 → 2 min ×2 → 5 min). Dessine,
            puis « Suivant » pour une nouvelle pose.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GestureTimer />
        </CardContent>
      </Card>
    </div>
  );
}
