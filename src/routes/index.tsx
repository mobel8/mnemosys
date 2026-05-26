import { createRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDecks, useTodayStats } from "@/lib/queries";
import { Route as rootRoute } from "./__root";

/**
 * Home page — minimal smoke-test stub that pings the backend so we catch
 * IPC regressions early. B2/B3 will replace this with the real dashboard.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});

function IndexPage() {
  const decks = useDecks();
  const today = useTodayStats();

  return (
    <div className="space-y-6 p-6">
      <header>
        <h2 className="text-3xl font-semibold tracking-tight">Mnemosys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back. Foundation ready — feature screens land in Wave B/C.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Reviews today</CardDescription>
            <CardTitle className="text-3xl">
              {today.isLoading ? "—" : (today.data?.reviews_done_today ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Due now</CardDescription>
            <CardTitle className="text-3xl">
              {today.isLoading ? "—" : (today.data?.due_now ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Retention</CardDescription>
            <CardTitle className="text-3xl">
              {today.isLoading ? "—" : `${Math.round((today.data?.retention_today ?? 0) * 100)}%`}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decks</CardTitle>
          <CardDescription>
            {decks.isLoading
              ? "Loading…"
              : decks.error
                ? `Error: ${decks.error.message}`
                : `${decks.data?.length ?? 0} deck(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {decks.data && decks.data.length > 0 ? (
            <ul className="space-y-2">
              {decks.data.map((deck) => (
                <li key={deck.id} className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: deck.color }} />
                  <span className="font-medium">{deck.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No decks yet — Wave B2 will add deck creation UI.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
