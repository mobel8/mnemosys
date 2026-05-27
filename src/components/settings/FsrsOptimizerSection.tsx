/**
 * Settings → "Optimiseur FSRS" (Session 4).
 *
 * Two render branches driven by the live review count:
 *
 *   1. **Below threshold** (< 1000 reviews):
 *      Show a progress bar + « keep revising » sentence. No button — the
 *      optimiser would error out and the message would be redundant.
 *
 *   2. **At / above threshold**:
 *      Show the dispo counter, a warning about parameter recalibration
 *      (irreversible without backup), and a primary action that calls
 *      `useOptimizeFsrsParams`. The mutation may take 5–30 s on a populated
 *      DB; we leave the button disabled while `isPending` so the learner
 *      can't fire it twice.
 *
 * Why exactly 1000?  See `src-tauri/src/fsrs/optimize.rs` —
 * `MIN_REVIEWS_FOR_OPTIM` is the threshold used by Ye et al. (SIGKDD 2022)
 * past which gradient descent on log-loss reliably out-fits the global
 * defaults. The backend honours an override but the UI uses the canonical
 * value so the message stays meaningful.
 */

import { CheckCircle2, FlaskConical, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { useOptimizeFsrsParams, useTotalReviewsCount } from "@/lib/queries";

/**
 * Threshold the UI checks against. Matches `MIN_REVIEWS_FOR_OPTIM` on the
 * Rust side; we hard-code it here rather than reading it through an extra
 * IPC call because the backend would error with the same number anyway.
 */
const MIN_REVIEWS = 1000;

function formatCount(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function FsrsOptimizerSection() {
  const totalQuery = useTotalReviewsCount();
  const optimize = useOptimizeFsrsParams({
    onSuccess: (result) => {
      toast({
        title: "Paramètres FSRS recalibrés",
        description: `21 paramètres recalculés à partir de ${formatCount(
          result.reviews_used,
        )} reviews.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Échec de l'optimisation",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const total = totalQuery.data ?? 0;
  const isLoading = totalQuery.isLoading;
  const canOptimize = total >= MIN_REVIEWS;
  // Clamp the progress ratio so we don't render a > 100 % bar when the user
  // crossed the threshold.
  const progress = Math.min(total / MIN_REVIEWS, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" />
          Optimiseur FSRS
        </CardTitle>
        <CardDescription>
          FSRS-6 utilise 21 paramètres calibrés sur une population globale. Avec assez de reviews
          dans ta base, on peut recalibrer ces paramètres sur <strong>ton</strong> historique
          personnel — Ye et al., SIGKDD 2022.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement de l'historique…</p>
        ) : !canOptimize ? (
          <section className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Reviews accumulées</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatCount(total)} / {formatCount(MIN_REVIEWS)}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={total}
                aria-valuemin={0}
                aria-valuemax={MIN_REVIEWS}
                aria-label="Progression vers le seuil d'optimisation"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Tu as <strong className="font-mono">{formatCount(total)}</strong>{" "}
              {total <= 1 ? "review" : "reviews"}. L'optimiseur demande au moins{" "}
              <strong>{formatCount(MIN_REVIEWS)}</strong> reviews pour produire des paramètres
              fiables. Continue à réviser quelques sessions puis reviens ici.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {formatCount(total)} reviews disponibles — suffisant pour calibrer.
                </p>
                <p className="text-muted-foreground">
                  L'optimisation prend généralement 5 à 30 s selon la taille de l'historique.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/60 bg-amber-50 p-4 dark:bg-amber-950/30">
              <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  Recalibrage des 21 paramètres FSRS
                </p>
                <p className="text-amber-800/90 dark:text-amber-200/90">
                  Calibrer recalcule les 21 paramètres FSRS à partir de ton historique. Tes
                  prochaines révisions utiliseront ces nouveaux paramètres, et les intervalles
                  affichés dans la file due peuvent évoluer.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => optimize.mutate({ minReviews: MIN_REVIEWS })}
                disabled={optimize.isPending}
              >
                {optimize.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FlaskConical className="h-4 w-4" />
                )}
                {optimize.isPending ? "Calibration en cours…" : "Calibrer FSRS"}
              </Button>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
