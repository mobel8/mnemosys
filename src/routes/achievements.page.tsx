/**
 * Achievements dashboard page — extracted from `./achievements.tsx` for
 * code-splitting via `lazyRouteComponent`. The grid component itself lives
 * in `src/components/Achievements.tsx`.
 *
 * Layout: header (title + subtitle) → grid → footer KPIs (current streak,
 * best streak, total reviews). Purely declarative; the heavy lifting is in
 * the child components.
 */

import { Achievements } from "@/components/Achievements";
import { Card, CardContent } from "@/components/ui/card";
import { useAchievements, useUserStats } from "@/lib/queries";

export default function AchievementsPage() {
  const stats = useUserStats();
  const unlocked = useAchievements();

  const totalUnlocked = unlocked.data?.length ?? 0;
  const accuracy =
    stats.data && stats.data.total_reviews > 0
      ? Math.round((stats.data.total_correct / stats.data.total_reviews) * 100)
      : null;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Succès</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Une vitrine de tes étapes franchies. Chaque badge se débloque une fois et reste acquis —
          aucune pénalité, aucun classement.
        </p>
      </header>

      <Achievements />

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <KpiTile label="Badges" value={String(totalUnlocked)} />
          <KpiTile label="Streak actuel" value={String(stats.data?.streak_current ?? 0)} />
          <KpiTile label="Meilleur streak" value={String(stats.data?.streak_best ?? 0)} />
          <KpiTile label="Réussite" value={accuracy !== null ? `${accuracy}%` : "—"} />
        </CardContent>
      </Card>
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
}

function KpiTile({ label, value }: KpiTileProps) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
