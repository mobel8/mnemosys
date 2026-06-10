/**
 * Metacognition calibration dashboard.
 *
 * Renders Goodman-Kruskal γ, calibration bias and a 10-bucket histogram
 * (predicted vs actual). v0.11 — the JOL pipeline is gone; stats are now
 * computed from CBM confidence ratings (1-5 captured before the flip,
 * Gardner-Medwin) against actual recall (rating ≥ 3). Mnemosys is, to our
 * knowledge, the first SRS app to expose this measure to learners.
 */

import { Brain } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCalibrationStats } from "@/lib/queries";

function gammaInterpretation(g: number): { label: string; color: string } {
  if (g >= 0.5) return { label: "Excellente calibration", color: "text-success" };
  if (g >= 0.2) return { label: "Bonne calibration", color: "text-success" };
  if (g >= 0) return { label: "Calibration modérée", color: "text-warning" };
  return { label: "Calibration inverse (à corriger)", color: "text-destructive" };
}

function biasInterpretation(b: number): string {
  if (Math.abs(b) < 0.05) return "Calibration équilibrée";
  if (b > 0) return `Surconfiance de ${(b * 100).toFixed(0)}%`;
  return `Sous-confiance de ${(-b * 100).toFixed(0)}%`;
}

export function CalibrationDashboard() {
  const { data: stats, isLoading } = useCalibrationStats();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Chargement…
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total_resolved < 30) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Calibration métacognitive
          </CardTitle>
          <CardDescription>
            Active l'évaluation de confiance dans Paramètres → Révision, puis révise ~30 cartes en
            notant ta confiance : tu verras ici si ta confiance prédit vraiment tes réussites.
          </CardDescription>
        </CardHeader>
        {stats && stats.total_resolved > 0 && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {stats.total_resolved} / 30 révisions avec confiance.
            </p>
          </CardContent>
        )}
      </Card>
    );
  }

  const gInt = gammaInterpretation(stats.gamma);
  const maxCount = Math.max(1, ...stats.buckets.map((b) => b.count));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Calibration métacognitive
        </CardTitle>
        <CardDescription>
          Ta confiance avant de voir la réponse vs tes réussites réelles, sur {stats.total_resolved}{" "}
          révisions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">γ (Gamma)</p>
            <p className="font-mono text-2xl font-semibold">{stats.gamma.toFixed(2)}</p>
            <p className={`text-xs ${gInt.color}`}>{gInt.label}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Biais</p>
            <p className="font-mono text-2xl font-semibold">
              {stats.bias >= 0 ? "+" : ""}
              {(stats.bias * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-muted-foreground">{biasInterpretation(stats.bias)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Révisions</p>
            <p className="font-mono text-2xl font-semibold">{stats.total_resolved}</p>
            <p className="text-xs text-muted-foreground">avec confiance</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Confiance prédite vs accuracy réelle
          </p>
          <div className="space-y-1.5">
            {stats.buckets.map((b) => {
              const pctPredicted = b.count > 0 ? Math.round(b.predicted * 100) : null;
              const pctActual = b.count > 0 ? Math.round(b.actual * 100) : null;
              const heightRel = b.count / maxCount;
              const over = b.predicted > b.actual;
              return (
                <div
                  key={b.band}
                  className="flex items-center gap-3 text-xs"
                  title={`Bucket ${Math.round(b.band * 100)}%`}
                >
                  <span className="w-12 text-right font-mono text-muted-foreground">
                    {Math.round(b.band * 100)}–{Math.round((b.band + 0.1) * 100)}%
                  </span>
                  <div className="flex-1">
                    <div className="flex h-6 items-center gap-0.5">
                      <div
                        className="flex h-full items-center justify-end rounded-l bg-primary/80 px-1 text-[10px] text-primary-foreground"
                        style={{
                          width: `${(pctPredicted ?? 0) * 0.5}%`,
                          minWidth: pctPredicted ? "2rem" : 0,
                        }}
                      >
                        {pctPredicted != null && `${pctPredicted}%`}
                      </div>
                      <div
                        className={`flex h-full items-center justify-start rounded-r px-1 text-[10px] ${over ? "bg-destructive text-destructive-foreground" : "bg-success text-success-foreground"}`}
                        style={{
                          width: `${(pctActual ?? 0) * 0.5}%`,
                          minWidth: pctActual ? "2rem" : 0,
                        }}
                      >
                        {pctActual != null && `${pctActual}%`}
                      </div>
                    </div>
                  </div>
                  <span className="w-12 text-right text-muted-foreground">
                    n={b.count} {b.count > 0 && <span style={{ opacity: heightRel }}>●</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary/80 align-middle" /> prédite
            · <span className="inline-block h-2 w-2 rounded-sm bg-success align-middle" /> bien
            calibrée ·{" "}
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive align-middle" />{" "}
            surconfiance
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
