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
 *
 * Rendered as the « Vocabulaire » tab of the « Créer » hub
 * (`src/routes/create.page.tsx`), which owns the page header — this
 * component renders content only (no h1).
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
import { useCardsInDeck, useCreateNote, useDecks } from "@/lib/queries";
import type { FrequencyBand } from "@/lib/tauri";

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

/**
 * Upper bound on existing cards fetched for duplicate detection. The frequency
 * builder tops out at 500 words and decks rarely exceed a few thousand cards,
 * so a single page comfortably covers the realistic case (P078).
 */
const DEDUP_FETCH_LIMIT = 5000;

/**
 * Map a Vocabulary-Builder band (`top_50`/`top_100`/`top_250`/`top_500`) onto
 * the canonical `FrequencyBand` taxonomy used by `create_note` and the deck
 * frequency-coverage card (P114). Every band the builder offers (rank ≤ 500)
 * falls inside the « Top 1k » bucket — the finest published `FrequencyBand`
 * available — so the generated cards now light up the coverage bar instead of
 * landing in « Non taggé ».
 */
const BAND_TO_FREQUENCY_BAND: FrequencyBand = "top_1k";

/** Lower-case + trim a card front for case-insensitive duplicate matching. */
function normalizeFront(value: string): string {
  return value.trim().toLowerCase();
}

export default function VocabularyBuilder({ translate }: VocabularyBuilderProps) {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  const firstBand = BANDS[0];
  const [bandId, setBandId] = useState<string>(firstBand?.id ?? "");
  const [deckId, setDeckId] = useState<number | null>(null);
  const [createdProgress, setCreatedProgress] = useState<number | null>(null);

  const createNote = useCreateNote();
  const isCreating = createdProgress !== null;

  // Existing cards in the chosen deck, used to skip words already added so the
  // nested bands (top_50 ⊂ top_100 ⊂ …) don't re-create duplicates (P078).
  const existingCardsQuery = useCardsInDeck(deckId ?? -1, DEDUP_FETCH_LIMIT, 0, {
    enabled: deckId !== null,
  });
  const existingFronts = useMemo(() => {
    const set = new Set<string>();
    for (const { note } of existingCardsQuery.data ?? []) {
      const front = note.fields.front;
      if (typeof front === "string") set.add(normalizeFront(front));
    }
    return set;
  }, [existingCardsQuery.data]);

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

  // How many words in the band aren't already in the deck — drives the button
  // label + hint so the learner sees the real number of cards they'll add.
  const newWordCount = useMemo(() => {
    if (deckId === null) return words.length;
    let n = 0;
    for (const { word } of words) {
      if (!existingFronts.has(normalizeFront(word))) n += 1;
    }
    return n;
  }, [words, existingFronts, deckId]);

  const duplicateCount = words.length - newWordCount;

  const canCreate = deckId !== null && newWordCount > 0 && !isCreating && !decksQuery.isLoading;

  async function handleCreate() {
    if (deckId === null || selectedBand === undefined || words.length === 0) return;
    const bandTag = `freq:${selectedBand.id}`;
    // Skip words whose front already exists in the deck (P078). The set is a
    // snapshot taken at click time; words minted during this run are added so a
    // band can't duplicate itself even before the query refetches.
    const alreadyPresent = new Set(existingFronts);
    let created = 0;
    let skipped = 0;
    const failures: string[] = [];
    setCreatedProgress(0);
    try {
      // Sequential — see file header for the rationale.
      for (const { word } of words) {
        const key = normalizeFront(word);
        if (alreadyPresent.has(key)) {
          skipped += 1;
          continue;
        }
        const back = translate?.(word)?.trim() ?? "";
        try {
          await createNote.mutateAsync({
            deckId,
            template: "basic",
            fields: { front: word, back },
            tags: [VOCAB_TAG, bandTag],
            // P114 — tag the canonical FrequencyBand so the deck's coverage
            // card counts these cards instead of bucketing them as untagged.
            frequencyBand: BAND_TO_FREQUENCY_BAND,
          });
          alreadyPresent.add(key);
          created += 1;
          setCreatedProgress(created);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setCreatedProgress(null);
    }

    const plural = skipped > 1 ? "s" : "";
    const skippedNote = skipped > 0 ? ` ${skipped} déjà présent${plural} ignoré${plural}.` : "";

    if (created > 0) {
      toast({
        title: `${created} carte${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}`,
        description:
          (failures.length === 0
            ? `Vocabulaire ajouté à « ${selectedDeck?.name ?? "le deck"} ».`
            : `${failures.length} échec${failures.length > 1 ? "s" : ""} (voir console).`) +
          skippedNote,
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
    } else if (skipped > 0) {
      toast({
        title: "Aucune nouvelle carte",
        description: `Les ${skipped} mot${skipped > 1 ? "s" : ""} de cette tranche sont déjà dans « ${
          selectedDeck?.name ?? "le deck"
        } ».`,
      });
    }
  }

  return (
    <div className="space-y-6">
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
                  Création… {createdProgress}/{newWordCount}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Créer {newWordCount} carte{newWordCount > 1 ? "s" : ""}
                </>
              )}
            </Button>
            {!isCreating && deckId !== null && duplicateCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {duplicateCount} mot{duplicateCount > 1 ? "s" : ""} déjà présent
                {duplicateCount > 1 ? "s" : ""} ser{duplicateCount > 1 ? "ont" : "a"} ignoré
                {duplicateCount > 1 ? "s" : ""}.
              </span>
            )}
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
