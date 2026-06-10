/**
 * "Today" KPI row — four mini-cards summarising the day at a glance.
 *
 * Order (left → right): reviews completed, cards due now, new cards
 * introduced today, retention rate today. Each tile applies a contextual
 * color when relevant (red for "due > 0", traffic-light gradient on the
 * retention bucket).
 *
 * The component is presentational; it expects the parent to feed the
 * `useTodayStats()` data and a loading flag so we keep the dashboard
 * orchestration in one place (`stats.tsx`).
 */

import { CheckCircle2, Clock, Sparkles, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { TodayStats } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface TodayCardProps {
  data: TodayStats | undefined;
  isLoading?: boolean;
}

type StatColor = "default" | "red" | "amber" | "green";

const COLOR_CLASSES: Record<StatColor, { icon: string; value: string }> = {
  default: { icon: "text-brand-500", value: "text-foreground" },
  // Semantic design-system tokens (theme-aware in light & dark) so the
  // traffic-light reads instantly without raw Tailwind palette values.
  red: { icon: "text-destructive", value: "text-destructive" },
  amber: { icon: "text-warning", value: "text-warning" },
  green: { icon: "text-success", value: "text-success" },
};

/** Bucketise the retention rate into a traffic-light color. */
export function retentionColor(rate: number): StatColor {
  if (rate >= 0.9) return "green";
  if (rate >= 0.75) return "amber";
  return "red";
}

export function TodayCard({ data, isLoading }: TodayCardProps) {
  const reviews = data?.reviews_done_today ?? 0;
  const due = data?.due_now ?? 0;
  const newCards = data?.new_cards_today ?? 0;
  const retention = data?.retention_today ?? 0;
  const retentionPct = Math.round(retention * 100);

  const dueColor: StatColor = due > 0 ? "red" : "default";
  // P098: « 0 % » en rouge quand aucune review aujourd'hui = « pas de données »
  // affiché comme un échec. Neutre tant qu'il n'y a rien à mesurer.
  const noReviews = reviews === 0;
  const retentionTone: StatColor = noReviews ? "default" : retentionColor(retention);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        icon={CheckCircle2}
        label="Révisions faites"
        value={isLoading ? "—" : String(reviews)}
        color="default"
        testid="today-reviews-done"
      />
      <StatTile
        icon={Clock}
        label="Cartes dues maintenant"
        value={isLoading ? "—" : String(due)}
        color={dueColor}
        testid="today-due-now"
      />
      <StatTile
        icon={Sparkles}
        label="Nouvelles cartes"
        value={isLoading ? "—" : String(newCards)}
        color="default"
        testid="today-new-cards"
      />
      <StatTile
        icon={TrendingUp}
        label="Rétention aujourd'hui"
        value={isLoading || noReviews ? "—" : `${retentionPct}%`}
        color={isLoading ? "default" : retentionTone}
        testid="today-retention"
      />
    </div>
  );
}

interface StatTileProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: StatColor;
  testid?: string;
}

function StatTile({ icon: Icon, label, value, color, testid }: StatTileProps) {
  const colors = COLOR_CLASSES[color];
  return (
    <Card data-testid={testid} className="overflow-hidden hover:shadow-md">
      <CardContent className="flex flex-col items-center gap-2 p-4 pt-5 text-center">
        <Icon className={cn("h-6 w-6", colors.icon)} />
        <span
          className={cn(
            "font-display text-3xl font-semibold leading-none tabular-nums",
            colors.value,
          )}
          data-testid={testid ? `${testid}-value` : undefined}
        >
          {value}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}
