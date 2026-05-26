import { createRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRetentionByDay, useReviewsByDay, useTodayStats } from "@/lib/queries";
import { Route as rootRoute } from "./__root";

/**
 * Stats page stub. Wave B4 will replace the raw numbers with recharts
 * visualisations.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: StatsPage,
});

function StatsPage() {
  const today = useTodayStats();
  const reviews = useReviewsByDay(30);
  const retention = useRetentionByDay(30);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Stats</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Quick numerics — full charts will land in Wave B4.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardContent>
          {today.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <pre className="rounded bg-muted p-4 text-xs">
              {JSON.stringify(today.data, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviews per day (last 30)</CardTitle>
          <CardDescription>{reviews.data?.length ?? 0} day(s) with activity</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention per day (last 30)</CardTitle>
          <CardDescription>{retention.data?.length ?? 0} day(s) sampled</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
