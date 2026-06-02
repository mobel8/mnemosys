/**
 * Home dashboard page component — extracted from `src/routes/index.tsx` so the
 * route can lazy-load it via `lazyRouteComponent`, keeping the initial JS
 * bundle small.
 */

import { BookOpen, ClipboardList, Plus, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { CreateDeckDialog } from "@/components/CreateDeckDialog";
import { DeckGrid } from "@/components/DeckGrid";
import { FirstRunWizard, isFirstRunPending } from "@/components/FirstRunWizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { useDecks, useLoadDemo, useTodayStats } from "@/lib/queries";

export default function IndexPage() {
  const decks = useDecks();
  const today = useTodayStats();
  const loadDemo = useLoadDemo({
    onSuccess: (count) => {
      toast({
        title: "Decks démo chargés",
        description: `${count} deck(s) ajouté(s).`,
      });
    },
    onError: (err) => {
      toast({
        title: "Chargement impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const deckList = decks.data ?? [];
  const isEmpty = !decks.isLoading && deckList.length === 0;

  // Show the first-run wizard once the decks query resolves and reports an
  // empty collection — but only if the user hasn't dismissed it before.
  // We gate on `decks.isSuccess` so a loading or error state doesn't
  // briefly flash the wizard before we know the deck list is genuinely
  // empty.
  useEffect(() => {
    if (decks.isSuccess && deckList.length === 0 && isFirstRunPending()) {
      setWizardOpen(true);
    }
  }, [decks.isSuccess, deckList.length]);

  return (
    <div className="space-y-8 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Mes decks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {deckList.length === 0
              ? "Crée ton premier deck pour commencer."
              : `${deckList.length} deck${deckList.length > 1 ? "s" : ""}`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nouveau deck
        </Button>
      </header>

      <section aria-label="Aujourd'hui" className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Aujourd'hui
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Révisions dues"
            value={String(today.data?.due_now ?? 0)}
            loading={today.isLoading}
            icon={ClipboardList}
          />
          <StatCard
            label="Nouvelles"
            value={String(today.data?.new_cards_today ?? 0)}
            loading={today.isLoading}
            icon={Sparkles}
          />
          <StatCard
            label="Rétention"
            value={`${Math.round((today.data?.retention_today ?? 0) * 100)}%`}
            loading={today.isLoading}
            icon={TrendingUp}
          />
        </div>
      </section>

      <section aria-label="Decks">
        {decks.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {["s1", "s2", "s3", "s4", "s5", "s6"].map((key) => (
              <DeckCardSkeleton key={key} />
            ))}
          </div>
        ) : decks.error ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">
              Erreur : {decks.error.message}
            </CardContent>
          </Card>
        ) : isEmpty ? (
          <EmptyState
            onCreate={() => setCreateOpen(true)}
            onLoadDemo={() => loadDemo.mutate()}
            loading={loadDemo.isPending}
          />
        ) : (
          <DeckGrid decks={deckList} />
        )}
      </section>

      <CreateDeckDialog open={createOpen} onOpenChange={setCreateOpen} />
      <FirstRunWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  icon: Icon,
}: {
  label: string;
  value: string;
  loading?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded-lg bg-muted" />
        ) : (
          <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Skeleton placeholder mirroring a `<DeckCard>` while the deck list loads. */
function DeckCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-5">
        <div className="space-y-2">
          <div className="h-5 w-2/3 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-1.5 pt-1">
          <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  onCreate,
  onLoadDemo,
  loading,
}: {
  onCreate: () => void;
  onLoadDemo: () => void;
  loading: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
          <BookOpen className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <p className="font-display text-xl tracking-tight">Aucun deck pour l'instant</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Crée ton premier deck ou charge les decks de démo pour explorer Mnemosys.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Nouveau deck
          </Button>
          <Button variant="outline" onClick={onLoadDemo} disabled={loading}>
            {loading ? "Chargement…" : "Charger les decks démo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
