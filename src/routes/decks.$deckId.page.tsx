/**
 * Deck detail page component — extracted from `src/routes/decks.$deckId.tsx`
 * for code-splitting via `lazyRouteComponent`.
 *
 * Layout:
 *   - Header: deck name + colored swatch, study CTA, add-card CTA, edit deck.
 *   - Stat ribbon (4 cards): total / due today / retention / new.
 *   - Tabs: "Cartes" (search + paginated list) / "Paramètres" (read-only
 *     summary for now, edit goes through the dialog).
 *
 * Pulls params via `getRouteApi("/decks/$deckId")` instead of importing the
 * sibling route file, so the route module can stay tiny without creating a
 * circular import that would defeat lazy-loading.
 */

import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Pencil, Play, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { CardList } from "@/components/CardList";
import { EditDeckDialog } from "@/components/EditDeckDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeck, useDeckStats } from "@/lib/queries";

const routeApi = getRouteApi("/decks/$deckId");

export default function DeckDetailPage() {
  const { deckId } = routeApi.useParams();
  const navigate = useNavigate();
  const deck = useDeck(deckId);
  const stats = useDeckStats(deckId);
  const [editOpen, setEditOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 300ms debounce so the search query (which hits the FTS index) doesn't
  // fire on every keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  if (deck.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement du deck…</div>;
  }
  if (deck.error || !deck.data) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Impossible de charger ce deck : {deck.error?.message ?? "inconnu"}
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/" })} className="mt-4">
          Retour à l'accueil
        </Button>
      </div>
    );
  }

  const d = deck.data;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-1 h-10 w-2 rounded-full"
            style={{ background: d.color }}
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1>
            {d.description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{d.description}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Rétention cible : {Math.round(d.desired_retention * 100)}%
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/review/$deckId" params={{ deckId }}>
              <Play className="h-4 w-4" />
              Étudier
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/decks/$deckId/new-card" params={{ deckId }}>
              <Plus className="h-4 w-4" />
              Nouvelle carte
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            Modifier le deck
          </Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total cartes" value={stats.data ? String(stats.data.total_cards) : "—"} />
        <Stat label="Dues aujourd'hui" value={stats.data ? String(stats.data.due_today) : "—"} />
        <Stat label="Nouvelles" value={stats.data ? String(stats.data.new_cards) : "—"} />
        <Stat
          label="En apprentissage"
          value={stats.data ? String(stats.data.learning_cards) : "—"}
        />
      </div>

      <Tabs defaultValue="cards" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cards">Cartes</TabsTrigger>
          <TabsTrigger value="settings">Paramètres</TabsTrigger>
        </TabsList>

        <TabsContent value="cards" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher dans les notes (min. 2 caractères)…"
              className="max-w-sm"
            />
            {searchInput && (
              <Button variant="ghost" size="sm" onClick={() => setSearchInput("")}>
                Effacer
              </Button>
            )}
          </div>
          <CardList deckId={deckId} searchQuery={debouncedSearch} />
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Paramètres du deck</CardTitle>
              <CardDescription>
                Édite ces valeurs via « Modifier le deck ». La gestion fine des paramètres FSRS
                arrive en Vague C.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <SettingRow label="Nom" value={d.name} />
              <SettingRow
                label="Rétention cible"
                value={`${Math.round(d.desired_retention * 100)}%`}
              />
              <SettingRow label="Description" value={d.description ?? "(aucune)"} />
              <SettingRow label="Créé le" value={new Date(d.created_at).toLocaleDateString()} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditDeckDialog deck={d} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardContent>
    </Card>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
