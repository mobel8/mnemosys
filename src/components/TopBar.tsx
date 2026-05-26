/**
 * Top bar — renders a breadcrumb derived from the current path plus a
 * quick "Add card" button that takes the user to the editor for the deck
 * they're currently looking at (or the home page when no deck is active).
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { StreakWidget } from "@/components/StreakWidget";
import { Button } from "@/components/ui/button";
import { useDecks } from "@/lib/queries";

interface Crumb {
  label: string;
  to?: string;
}

function buildCrumbs(pathname: string, deckName?: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [{ label: "Home" }];
  }
  const crumbs: Crumb[] = [{ label: "Home", to: "/" }];
  const [first, second, third] = segments;
  if (first === "decks" && second) {
    crumbs.push({ label: deckName ?? `Deck #${second}`, to: `/decks/${second}` });
    if (third === "new-card") {
      crumbs.push({ label: "New card" });
    }
  } else if (first === "review" && second) {
    crumbs.push({ label: deckName ?? `Deck #${second}`, to: `/decks/${second}` });
    crumbs.push({ label: "Review" });
  } else if (first === "stats") {
    crumbs.push({ label: "Stats" });
  } else if (first === "achievements") {
    crumbs.push({ label: "Succès" });
  } else if (first === "settings") {
    crumbs.push({ label: "Settings" });
  }
  return crumbs;
}

export function TopBar() {
  const router = useRouterState();
  const pathname = router.location.pathname;
  const decks = useDecks();

  const deckIdMatch = pathname.match(/^\/(?:decks|review)\/(\d+)/);
  const activeDeckId = deckIdMatch ? Number(deckIdMatch[1]) : null;
  const activeDeck = activeDeckId ? decks.data?.find((d) => d.id === activeDeckId) : undefined;

  const crumbs = buildCrumbs(pathname, activeDeck?.name);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-6 backdrop-blur">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1 truncate text-sm text-muted-foreground">
          {crumbs.map((crumb, idx) => {
            const last = idx === crumbs.length - 1;
            // The `to` path is unique per crumb when present; otherwise the
            // label is unique within a given route (no two leaf segments
            // share a label). Either is stable across renders.
            const key = crumb.to ?? `leaf:${crumb.label}`;
            return (
              <li key={key} className="flex items-center gap-1">
                {idx > 0 && <span aria-hidden>/</span>}
                {crumb.to && !last ? (
                  <Link to={crumb.to} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className={last ? "font-medium text-foreground" : undefined}>
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-2">
        <StreakWidget />
        <Button asChild size="sm" variant="default">
          {activeDeckId ? (
            <Link to="/decks/$deckId/new-card" params={{ deckId: activeDeckId }}>
              <Plus className="h-4 w-4" />
              Add card
            </Link>
          ) : (
            <Link to="/">
              <Plus className="h-4 w-4" />
              Add card
            </Link>
          )}
        </Button>
      </div>
    </header>
  );
}
