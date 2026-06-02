/**
 * Vocabulary Builder (Sous-feature 2 — top-N English frequency vocabulary).
 *
 * Flow:
 *   1. The learner picks a frequency band (top 50 … top 500) and a target deck.
 *   2. A preview lists every word in the band as `font-mono` badges, ranked by
 *      frequency. When a `translate` prop is supplied, each badge also shows
 *      the localised gloss so the learner sees what they're about to study.
 *   3. "Créer les cartes" walks the band **sequentially** through
 *      `useCreateNote.mutateAsync` (mirrors `AiGenerator` — parallel calls
 *      would spam the DB and lose deterministic ordering). Each card is a
 *      Basic note: `front` = the English word, `back` = the translation if a
 *      `translate` prop resolved one, otherwise empty (to be completed later).
 *      Every note is tagged `vocab` plus a `freq:top_N` band tag.
 *
 * No new persistence beyond `create_note`; the component holds only UI state.
 * The data source is `@/lib/frequency-en` (pure, accurate, ~500 lemmas).
 */

import { Link } from "@tanstack/react-router";
import { BookA, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { BANDS, type FreqWord, wordsInBand } from "@/lib/frequency-en";
import { useCreateNote, useDecks } from "@/lib/queries";

/**
 * Optional local translation lookup, injected by the orchestrator. Returns the
 * gloss for an English `word`, or `undefined`/empty when no translation is
 * known. Kept synchronous so the preview can render glosses inline without an
 * async waterfall; a missing entry just leaves the card's back blank.
 */
export type TranslateFn = (word: string) => string | undefined;

export interface VocabularyBuilderProps {
  /**
   * Optional English → target-language translator. When provided, generated
   * cards get their `back` pre-filled and the preview shows the gloss under
   * each word. Omit it and cards are created with an empty back to complete.
   */
  translate?: TranslateFn;
}

/** Tag attached to every generated note so the deck stays filterable. */
const VOCAB_TAG = "vocab";

/** How many preview badges to render before collapsing into a "+N" summary. */
const PREVIEW_LIMIT = 120;

export default function VocabularyBuilder({ translate }: VocabularyBuilderProps) {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  const firstBand = BANDS[0];
  const [bandId, setBandId] = useState<string>(firstBand?.id ?? "");
  const [deckId, setDeckId] = useState<number | null>(null);
  const [createdProgress, setCreatedProgress] = useState<number | null>(null);

  const createNote = useCreateNote();
  const isCreating = createdProgress !== null;

  const deckSelectId = useId();
  const bandSelectId = useId();

  const selectedBand = useMemo(() => BANDS.find((b) => b.id === bandId) ?? BANDS[0], [bandId]);

  const words: FreqWord[] = useMemo(
    () => (selectedBand ? wordsInBand(selectedBand.max) : []),
    [selectedBand],
  );

  const translatedCount = useMemo(() => {
    if (!translate) return 0;
    let n = 0;
    for (const { word } of words) {
      const gloss = translate(word)?.trim();
      if (gloss) n += 1;
    }
    return n;
  }, [translate, words]);

  const visibleWords = words.slice(0, PREVIEW_LIMIT);
  const overflow = words.length - visibleWords.length;

  const selectedDeck = useMemo(() => decks.find((d) => d.id === deckId) ?? null, [decks, deckId]);

  const canCreate = deckId !== null && words.length > 0 && !isCreating && !decksQuery.isLoading;

  async function handleCreate() {
    if (deckId === null || selectedBand === undefined || words.length === 0) return;
    const bandTag = `freq:${selectedBand.id}`;
    let created = 0;
    const failures: string[] = [];
    setCreatedProgress(0);
    try {
      // Sequential — see file header for the rationale.
      for (const { word } of words) {
        const back = translate?.(word)?.trim() ?? "";
        try {
          await createNote.mutateAsync({
            deckId,
            template: "basic",
            fields: { front: word, back },
            tags: [VOCAB_TAG, bandTag],
          });
          created += 1;
          setCreatedProgress(created);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setCreatedProgress(null);
    }

    if (created > 0) {
      toast({
        title: `${created} carte${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}`,
        description:
          failures.length === 0
            ? `Vocabulaire ajouté à « ${selectedDeck?.name ?? "le deck"} ».`
            : `${failures.length} échec${failures.length > 1 ? "s" : ""} (voir console).`,
      });
      if (failures.length > 0) {
        console.warn("[vocab] some cards failed to create", failures);
      }
    } else if (failures.length > 0) {
      toast({
        title: "Aucune carte créée",
        description: failures[0] ?? "Échec inconnu.",
        variant: "destructive",
      });
      console.warn("[vocab] every card failed to create", failures);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <BookA className="h-6 w-6 text-primary" aria-hidden />
          Vocabulaire par fréquence
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Construis ton vocabulaire anglais à partir des mots les plus fréquents. Choisis une
          tranche, un deck cible, et génère des cartes en un clic — l'effort 80/20 de
          l'apprentissage des langues.
        </p>
      </header>

      {/* ---------- Config card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wand2 className="h-5 w-5 text-primary" aria-hidden />
            Paramètres
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Band picker */}
          <div className="space-y-2">
            <Label htmlFor={bandSelectId}>Tranche de fréquence</Label>
            <Select value={bandId} onValueChange={setBandId} disabled={isCreating}>
              <SelectTrigger id={bandSelectId}>
                <SelectValue placeholder="Choisir une tranche" />
              </SelectTrigger>
              <SelectContent>
                {BANDS.map((band) => (
                  <SelectItem key={band.id} value={band.id}>
                    {band.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{words.length}</span> mot
              {words.length > 1 ? "s" : ""} dans cette tranche.
            </p>
          </div>

          {/* Deck picker */}
          <div className="space-y-2">
            <Label htmlFor={deckSelectId}>Deck cible</Label>
            {decksQuery.isLoading ? (
              <div className="h-9 w-full animate-pulse rounded-lg bg-muted" aria-hidden />
            ) : decksQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                Impossible de charger les decks.{" "}
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => void decksQuery.refetch()}
                >
                  Réessayer
                </button>
              </div>
            ) : decks.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                Aucun deck disponible.{" "}
                <Link
                  to="/"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Crée d'abord un deck
                </Link>{" "}
                pour y ajouter du vocabulaire.
              </div>
            ) : (
              <Select
                value={deckId === null ? "" : String(deckId)}
                onValueChange={(value) => setDeckId(Number(value))}
                disabled={isCreating}
              >
                <SelectTrigger id={deckSelectId}>
                  <SelectValue placeholder="Choisir un deck" />
                </SelectTrigger>
                <SelectContent>
                  {decks.map((deck) => (
                    <SelectItem key={deck.id} value={String(deck.id)}>
                      {deck.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Translation availability hint */}
          <p className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
            {translate ? (
              <>
                Verso pré-rempli avec une traduction pour{" "}
                <span className="font-mono tabular-nums text-foreground">{translatedCount}</span> /{" "}
                <span className="font-mono tabular-nums">{words.length}</span> mots. Les mots sans
                traduction connue laissent un verso vide à compléter.
              </>
            ) : (
              <>Les cartes sont créées avec un recto (mot anglais) et un verso vide à compléter.</>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" onClick={handleCreate} disabled={!canCreate}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Création… {createdProgress}/{words.length}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Créer {words.length} carte{words.length > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Preview ---------- */}
      {words.length > 0 ? (
        <section aria-labelledby="vocab-preview-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="vocab-preview-heading"
              className="font-display text-lg font-semibold tracking-tight"
            >
              Aperçu des mots
            </h2>
            <p className="text-xs text-muted-foreground">Classés par fréquence.</p>
          </div>

          <Card>
            <CardContent className="flex flex-wrap gap-2 p-4">
              {visibleWords.map(({ rank, word }) => {
                const gloss = translate?.(word)?.trim();
                return (
                  <Badge
                    key={word}
                    variant="outline"
                    className="gap-1.5 font-mono font-normal"
                    title={gloss ? `${word} — ${gloss}` : word}
                  >
                    <span className="text-muted-foreground tabular-nums">{rank}</span>
                    <span className="text-foreground">{word}</span>
                    {gloss ? <span className="text-muted-foreground">· {gloss}</span> : null}
                  </Badge>
                );
              })}
              {overflow > 0 && (
                <Badge variant="secondary" className="font-mono tabular-nums">
                  +{overflow}
                </Badge>
              )}
            </CardContent>
          </Card>
        </section>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BookA className="h-8 w-8 text-primary/70" aria-hidden />
            <p className="font-display text-base font-semibold tracking-tight">
              Aucune tranche sélectionnée
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Choisis une tranche de fréquence ci-dessus pour prévisualiser les mots à ajouter.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
