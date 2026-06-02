/**
 * Reading Import (Vague 17 — LingQ-style extensive reading).
 *
 * Flow:
 *   1. Learner pastes a text and picks the language + (optionally) a target
 *      deck.
 *   2. The text is tokenised into word / non-word segments. Each distinct
 *      lower-cased word is looked up via `useWordStatuses`; missing words
 *      default to `new`.
 *   3. Every word is a button coloured by status:
 *        - new      → light-blue highlight (unknown, the default)
 *        - learning → amber highlight (actively acquiring)
 *        - known    → no highlight (mastered)
 *      Clicking a word cycles new → learning → known → new and persists the
 *      change (optimistically mirrored in local state so the colour flips
 *      instantly, even before the round-trip resolves).
 *   4. "Créer des cartes" mints a Basic card (front = word, back = « (à
 *      traduire) ») for every word currently marked `learning`, into the
 *      chosen deck.
 *   5. A stats line summarises coverage: unknown words, total distinct words,
 *      and the % of distinct words already `known`.
 *
 * No new persistence beyond `word_status`; the component holds the parsed
 * text + per-word overrides in local state.
 */

import { Link } from "@tanstack/react-router";
import { BookOpen, Loader2, Sparkles } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { lookupLocal } from "@/lib/dictionary";
import {
  useCreateCardsFromWords,
  useDecks,
  useSetWordStatus,
  useWordStatuses,
} from "@/lib/queries";
import type { WordStatusKind } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Language options — value is the ISO 639-1 hint stored alongside the word. */
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "ja", label: "日本語" },
] as const;

type LanguageValue = (typeof LANGUAGES)[number]["value"];

/** Max characters accepted before we refuse to tokenise (perf guard). */
const MAX_TEXT_CHARS = 20_000;

/** One parsed segment of the source text. */
interface Token {
  /** Stable key (index-based — the text is immutable once tokenised). */
  key: string;
  /** The raw text exactly as it appeared (preserves original casing). */
  raw: string;
  /** `true` for a word token, `false` for whitespace/punctuation. */
  isWord: boolean;
  /** Normalised (lower-cased) form — only meaningful when `isWord`. */
  normalized: string;
}

/**
 * Split `text` into word / non-word tokens. A "word" is a maximal run of
 * Unicode letters, digits, apostrophes and hyphens; everything else (spaces,
 * punctuation, newlines) is preserved verbatim as a non-word token so the
 * rendered text reads identically to the input.
 *
 * Exported for unit testing.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Letters (incl. accents via \p{L}), digits, apostrophes, hyphens.
  const wordRe = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  match = wordRe.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      const gap = text.slice(lastIndex, match.index);
      tokens.push({ key: `s${i}`, raw: gap, isWord: false, normalized: "" });
      i += 1;
    }
    const raw = match[0];
    tokens.push({
      key: `w${i}`,
      raw,
      isWord: true,
      normalized: raw.toLowerCase(),
    });
    i += 1;
    lastIndex = match.index + raw.length;
    match = wordRe.exec(text);
  }
  if (lastIndex < text.length) {
    tokens.push({ key: `s${i}`, raw: text.slice(lastIndex), isWord: false, normalized: "" });
  }
  return tokens;
}

/** Next status in the new → learning → known → new cycle. */
function nextStatus(current: WordStatusKind): WordStatusKind {
  switch (current) {
    case "new":
      return "learning";
    case "learning":
      return "known";
    case "known":
      return "new";
  }
}

/** Token-based classes for each status' word pill (design.md voice). */
function statusClasses(status: WordStatusKind): string {
  switch (status) {
    case "new":
      return "bg-primary/10 text-foreground hover:bg-primary/20 dark:bg-primary/25 dark:hover:bg-primary/35";
    case "learning":
      return "bg-warning/25 text-foreground hover:bg-warning/40";
    case "known":
      return "bg-transparent text-muted-foreground hover:bg-muted";
  }
}

const STATUS_LABEL: Record<WordStatusKind, string> = {
  new: "inconnu",
  learning: "en cours",
  known: "connu",
};

export function ReadingImport() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<LanguageValue>("en");
  const [deckId, setDeckId] = useState<number | null>(null);
  /** Optimistic per-word status overrides (word → status). */
  const [overrides, setOverrides] = useState<Record<string, WordStatusKind>>({});
  /** Hovered word → inline dictionary popover (definition + IPA + translation). */
  const [hover, setHover] = useState<{ word: string; x: number; y: number } | null>(null);

  const textInputId = useId();
  const langSelectId = useId();
  const deckSelectId = useId();

  const setStatus = useSetWordStatus();
  const createCards = useCreateCardsFromWords();

  // Tokenise the *submitted* text (not the live draft) so editing the
  // textarea doesn't re-render hundreds of word buttons on every keystroke.
  const tokens = useMemo(() => tokenize(text), [text]);

  // Distinct words drive the status query. Sorted for a stable query key.
  const distinctWords = useMemo(() => {
    const set = new Set<string>();
    for (const t of tokens) if (t.isWord) set.add(t.normalized);
    return Array.from(set).sort();
  }, [tokens]);

  const statusesQuery = useWordStatuses(distinctWords, language, {
    enabled: distinctWords.length > 0,
  });

  // Merge persisted statuses with optimistic overrides. Missing word → "new".
  const statusByWord = useMemo(() => {
    const map = new Map<string, WordStatusKind>();
    for (const row of statusesQuery.data ?? []) {
      map.set(row.word, row.status);
    }
    for (const [word, status] of Object.entries(overrides)) {
      map.set(word, status);
    }
    return map;
  }, [statusesQuery.data, overrides]);

  function statusOf(word: string): WordStatusKind {
    return statusByWord.get(word) ?? "new";
  }

  function handleAnalyze() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setText(draft);
    // Clearing overrides avoids stale colours leaking across two texts that
    // share words but where the learner just reclassified some of them.
    setOverrides({});
  }

  function handleWordClick(word: string) {
    const next = nextStatus(statusOf(word));
    // Optimistic flip — the colour updates immediately.
    setOverrides((prev) => ({ ...prev, [word]: next }));
    setStatus.mutate(
      { word, status: next, language },
      {
        onError: (err) => {
          // Roll back the optimistic change on failure.
          setOverrides((prev) => {
            const copy = { ...prev };
            delete copy[word];
            return copy;
          });
          toast({
            title: "Statut non enregistré",
            description: err.message ?? "Erreur inconnue",
            variant: "destructive",
          });
        },
      },
    );
  }

  // Coverage stats over distinct words. Reads `statusByWord` directly (rather
  // than the `statusOf` helper) so the dependency list is exactly what biome's
  // exhaustive-deps rule expects — no suppression needed.
  const stats = useMemo(() => {
    const total = distinctWords.length;
    let known = 0;
    let learning = 0;
    for (const word of distinctWords) {
      const s = statusByWord.get(word) ?? "new";
      if (s === "known") known += 1;
      else if (s === "learning") learning += 1;
    }
    const unknown = total - known; // new + learning
    const coverage = total > 0 ? Math.round((known / total) * 100) : 0;
    return { total, known, learning, unknown, coverage };
  }, [distinctWords, statusByWord]);

  // Words eligible to become cards: those currently marked "learning".
  const learningWords = useMemo(
    () => distinctWords.filter((w) => (statusByWord.get(w) ?? "new") === "learning"),
    [distinctWords, statusByWord],
  );

  function handleCreateCards() {
    if (deckId === null || learningWords.length === 0) return;
    createCards.mutate(
      { deckId, words: learningWords },
      {
        onSuccess: (count) => {
          toast({
            title: `${count} carte${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}`,
            description: "Front = mot, verso = « (à traduire) ». Édite-les dans le deck.",
          });
        },
        onError: (err) => {
          toast({
            title: "Création impossible",
            description: err.message ?? "Erreur inconnue",
            variant: "destructive",
          });
        },
      },
    );
  }

  const draftTooLong = draft.length > MAX_TEXT_CHARS;
  const canAnalyze = draft.trim().length > 0 && !draftTooLong;
  const canCreateCards = deckId !== null && learningWords.length > 0 && !createCards.isPending;

  return (
    <div className="space-y-6" data-testid="reading-import">
      {/* ---------- Input card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            Texte à lire
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={textInputId}>Colle un article, un paragraphe…</Label>
            <Textarea
              id={textInputId}
              rows={6}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Colle ici le texte dans la langue que tu apprends."
              className={cn("min-h-[140px] text-sm", draftTooLong && "border-destructive")}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {draft.length.toLocaleString("fr-FR")} / {MAX_TEXT_CHARS.toLocaleString("fr-FR")}{" "}
                caractères
              </span>
              {draftTooLong && <span className="text-destructive">Texte trop long.</span>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={langSelectId}>Langue</Label>
              <select
                id={langSelectId}
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageValue)}
                className={cn(
                  "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm shadow-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
              >
                {LANGUAGES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={deckSelectId}>Deck cible (pour les cartes)</Label>
              <select
                id={deckSelectId}
                value={deckId ?? ""}
                onChange={(e) => setDeckId(e.target.value === "" ? null : Number(e.target.value))}
                className={cn(
                  "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm shadow-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
              >
                <option value="">— Choisir un deck —</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button type="button" onClick={handleAnalyze} disabled={!canAnalyze}>
            <BookOpen className="h-4 w-4" />
            Analyser le texte
          </Button>
        </CardContent>
      </Card>

      {/* ---------- Reader + stats ---------- */}
      {tokens.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lecture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Stats line */}
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
              data-testid="reading-stats"
            >
              <span className="text-muted-foreground">
                <strong className="text-foreground">{stats.unknown}</strong> mot
                {stats.unknown > 1 ? "s" : ""} inconnu{stats.unknown > 1 ? "s" : ""} /{" "}
                <strong className="text-foreground">{stats.total}</strong> total
              </span>
              <span className="text-muted-foreground">
                <strong className="text-foreground">{stats.coverage}%</strong> de couverture connue
              </span>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className={cn("h-3 w-3 rounded", statusClasses("new"))} /> inconnu
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={cn("h-3 w-3 rounded border", statusClasses("learning"))} /> en
                cours
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded border" /> connu
              </span>
              <span>· clique un mot pour changer son statut</span>
            </div>

            {/* The text itself */}
            <p
              className="whitespace-pre-wrap break-words text-base leading-8"
              data-testid="reading-text"
            >
              {tokens.map((token) =>
                token.isWord ? (
                  <button
                    key={token.key}
                    type="button"
                    onClick={() => handleWordClick(token.normalized)}
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setHover({
                        word: token.normalized,
                        x: r.left + r.width / 2,
                        y: r.top,
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                    className={cn(
                      "cursor-pointer rounded px-0.5 transition-colors",
                      statusClasses(statusOf(token.normalized)),
                    )}
                    title={`${token.raw} — ${STATUS_LABEL[statusOf(token.normalized)]}`}
                    data-testid="reading-word"
                    data-word={token.normalized}
                    data-status={statusOf(token.normalized)}
                  >
                    {token.raw}
                  </button>
                ) : (
                  <span key={token.key}>{token.raw}</span>
                ),
              )}
            </p>

            {/* Inline dictionary on hover (definition + IPA + FR translation) */}
            {hover &&
              (() => {
                const entry = lookupLocal(hover.word);
                if (!entry) return null;
                return (
                  <div
                    className="pointer-events-none fixed z-50 w-max max-w-xs -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
                    style={{ left: hover.x, top: hover.y - 8 }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-display font-semibold">{entry.word}</span>
                      <span className="font-mono text-xs text-muted-foreground">{entry.ipa}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      <span className="text-accent-foreground">{entry.pos}</span> · {entry.fr}
                    </div>
                  </div>
                );
              })()}

            {/* Create cards action */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button
                type="button"
                onClick={handleCreateCards}
                disabled={!canCreateCards}
                data-testid="create-cards-button"
              >
                {createCards.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Création…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Créer {learningWords.length} carte{learningWords.length > 1 ? "s" : ""}
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                {learningWords.length === 0
                  ? "Marque des mots « en cours » pour en faire des cartes."
                  : deckId === null
                    ? "Choisis d'abord un deck cible ci-dessus."
                    : `${learningWords.length} mot${
                        learningWords.length > 1 ? "s" : ""
                      } « en cours » prêt${learningWords.length > 1 ? "s" : ""}.`}
              </span>
            </div>
            {decks.length === 0 && !decksQuery.isLoading && (
              <p className="text-xs text-muted-foreground">
                Aucun deck disponible.{" "}
                <Link
                  to="/"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Crée d'abord un deck
                </Link>{" "}
                pour pouvoir générer des cartes.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
