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
import { convertFileSrc } from "@tauri-apps/api/core";
import { BookOpen, Loader2, RotateCw, Sparkles } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { WordLookupPopover } from "@/components/WordLookupPopover";
import { type DictEntry, lookupLocal } from "@/lib/dictionary";
import {
  useCardsInDeck,
  useCreateCardsFromWords,
  useCreateNote,
  useDecks,
  useGenerateCardsFromText,
  useSettingsQuery,
  useSetWordStatus,
  useSynthesizeAudio,
  useWordStatuses,
} from "@/lib/queries";
import type { TTSVoice, WordStatusKind } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/**
 * Language options — value is the ISO 639-1 hint stored alongside the word.
 *
 * The inline dictionary (`lookupLocal`) is **English → French only** today, and
 * the tokeniser splits on Unicode word boundaries (whitespace/punctuation),
 * which does NOT segment space-less scripts such as Chinese/Japanese/Korean.
 * Offering five languages with no matching data made the picker misleading:
 * every non-English word fell back to « définition indisponible » and CJK text
 * tokenised into one giant run. So the picker is intentionally restricted to
 * English until per-language dictionaries (and CJK segmentation) land — see
 * P012. The reader still works for any language at the *status-tracking* level
 * (click a word to mark it new/learning/known); only the offline gloss is
 * English-specific, and unknown words fall back to the AI lookup affordance.
 */
const LANGUAGES = [{ value: "en", label: "English" }] as const;

type LanguageValue = (typeof LANGUAGES)[number]["value"];

/** Max characters accepted before we refuse to tokenise (perf guard). */
const MAX_TEXT_CHARS = 20_000;

/**
 * Radix `<Select>` forbids an empty-string item value, so the "no deck chosen"
 * state is carried by this sentinel and converted back to `null` on change.
 */
const NO_DECK = "__none__";

/**
 * Upper bound on existing cards fetched for duplicate detection (P078). A
 * reading session yields a handful of new words; this caps the snapshot we
 * scan for already-present fronts.
 */
const DEDUP_FETCH_LIMIT = 5000;

/** Lower-case + trim a card front for case-insensitive duplicate matching. */
function normalizeFront(value: string): string {
  return value.trim().toLowerCase();
}

/** TTS defaults + validation — same pattern as TtsButton / ShadowingPractice. */
const DEFAULT_VOICE: TTSVoice = "nova";
const DEFAULT_SPEED = 1.0;
const VALID_VOICES: readonly TTSVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "coral",
  "sage",
];

/** Map the persisted `tts_voice` setting to a valid voice (default « nova »). */
function resolveVoice(raw: string | null | undefined): TTSVoice {
  if (raw && (VALID_VOICES as readonly string[]).includes(raw)) return raw as TTSVoice;
  return DEFAULT_VOICE;
}

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
  // Letters (incl. accents via \p{L}), digits, with apostrophes/hyphens allowed
  // only *between* alphanumerics — a word must start AND end on a letter/digit
  // (P120: trailing « ' » / « - » would otherwise fragment word-status tracking).
  const wordRe = /[\p{L}\p{N}](?:[\p{L}\p{N}'’-]*[\p{L}\p{N}])?/gu;
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
  /**
   * Which token's lookup popover is open (keyed by the unique token key, not
   * the normalised word, so repeated words don't open every occurrence at once).
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** AI-resolved glosses for words missing from the offline dictionary. */
  const [aiEntries, setAiEntries] = useState<Record<string, DictEntry>>({});
  /** Word currently being looked up via the AI (null = none in flight). */
  const [aiLoadingWord, setAiLoadingWord] = useState<string | null>(null);
  /** Last AI lookup error, keyed by word, for the popover unavailable state. */
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});

  const textInputId = useId();
  const langSelectId = useId();
  const deckSelectId = useId();

  const setStatus = useSetWordStatus();
  const createCards = useCreateCardsFromWords();
  const createNote = useCreateNote();
  const synthesize = useSynthesizeAudio();
  const generateCards = useGenerateCardsFromText();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Voix + vitesse depuis les réglages (fallback « nova » / 1.0), comme
  // TtsButton / ShadowingPractice — la voix n'est plus codée en dur (audit).
  const settingsQuery = useSettingsQuery();
  const voice = resolveVoice(settingsQuery.data?.tts_voice);
  const speed = settingsQuery.data?.tts_speed ?? DEFAULT_SPEED;

  // Existing cards in the chosen deck, used to skip words already added so the
  // reading flow doesn't re-create duplicates across overlapping texts (P078).
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
        onSuccess: (saved) => {
          // P121 — the server is now the authority for this word. Drop the
          // override (only if it still equals what we persisted, so a rapid
          // re-click that queued a newer status isn't clobbered) so the
          // refetched value can never be masked indefinitely.
          setOverrides((prev) => {
            if (prev[word] !== saved.status) return prev;
            const copy = { ...prev };
            delete copy[word];
            return copy;
          });
        },
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

  /** Resolve the gloss for a word: AI override wins, else the offline lookup. */
  const entryOf = useCallback(
    (word: string): DictEntry | null => aiEntries[word] ?? lookupLocal(word),
    [aiEntries],
  );

  /**
   * Speak a word via the project TTS (used by the popover speaker button),
   * honouring the voice + speed configured in the settings.
   */
  const handleSpeak = useCallback(
    async (word: string) => {
      try {
        const res = await synthesize.mutateAsync({ text: word, voice, speed });
        const audio = audioRef.current;
        if (audio) {
          audio.src = convertFileSrc(res.path);
          audio.currentTime = 0;
          await audio.play().catch(() => {});
        }
      } catch (err) {
        toast({
          title: "Lecture audio impossible",
          description: err instanceof Error ? err.message : "Erreur inconnue",
          variant: "destructive",
        });
      }
    },
    [synthesize, voice, speed],
  );

  /** Mint one Basic card from a popover (front = word, back = gloss + IPA). */
  const handleCreateCardFromEntry = useCallback(
    (entry: DictEntry) => {
      if (deckId === null) {
        toast({
          title: "Choisis d'abord un deck",
          description: "Sélectionne un deck cible ci-dessus pour créer une carte.",
          variant: "destructive",
        });
        return;
      }
      createNote.mutate(
        {
          deckId,
          template: "basic",
          fields: { front: entry.word, back: `${entry.fr} — ${entry.ipa}` },
          tags: ["reading"],
        },
        {
          onSuccess: () => {
            toast({
              title: "Carte créée",
              description: `« ${entry.word} » ajouté au deck.`,
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
    },
    [deckId, createNote],
  );

  /**
   * Ask the AI to define a word absent from the offline dictionary. We reuse
   * the card-generation command (one card max) and read its front/back as a
   * lightweight gloss; on success the popover re-renders with the new entry.
   */
  const handleAiLookup = useCallback(
    (word: string) => {
      setAiLoadingWord(word);
      setAiErrors((prev) => {
        const copy = { ...prev };
        delete copy[word];
        return copy;
      });
      generateCards.mutate(
        { text: word, maxCards: 1, language },
        {
          onSuccess: (cards) => {
            const first = cards[0];
            if (!first) {
              setAiErrors((prev) => ({ ...prev, [word]: "Aucune définition générée." }));
              return;
            }
            // `basic` → { front, back }; `cloze` → { text }. Read whichever is
            // present as the gloss, falling back gracefully.
            const fields = first.fields;
            const back = typeof fields.back === "string" ? fields.back.trim() : "";
            const front = typeof fields.front === "string" ? fields.front.trim() : "";
            const cloze = typeof fields.text === "string" ? fields.text.trim() : "";
            setAiEntries((prev) => ({
              ...prev,
              [word]: {
                word,
                ipa: "",
                pos: "nom",
                fr: back || front || cloze || "(définition générée)",
              },
            }));
          },
          onError: (err) => {
            setAiErrors((prev) => ({
              ...prev,
              [word]: err.message ?? "Échec de la génération IA.",
            }));
          },
          onSettled: () => {
            setAiLoadingWord((cur) => (cur === word ? null : cur));
          },
        },
      );
    },
    [language, generateCards],
  );

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

  // Of those, the ones not already present in the deck (P078). The backend
  // dedups within a single batch but not against existing cards, so we filter
  // here to avoid re-minting words the learner already studied.
  const wordsToCreate = useMemo(
    () => learningWords.filter((w) => !existingFronts.has(normalizeFront(w))),
    [learningWords, existingFronts],
  );
  const duplicateCount = learningWords.length - wordsToCreate.length;

  function handleCreateCards() {
    if (deckId === null || wordsToCreate.length === 0) return;
    const skipped = duplicateCount;
    // P079 — pre-fill the back from the embedded EN→FR dictionary (AI override
    // wins) so common words land translated instead of « (à traduire) ». The
    // array is positional vs `wordsToCreate`; an empty string falls back to the
    // placeholder backend-side.
    const translations = wordsToCreate.map((w) => entryOf(w)?.fr ?? "");
    const glossed = translations.filter((t) => t.length > 0).length;
    createCards.mutate(
      { deckId, words: wordsToCreate, translations },
      {
        onSuccess: (count) => {
          toast({
            title: `${count} carte${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}`,
            description:
              (glossed > 0
                ? `${glossed} verso${glossed > 1 ? "s" : ""} pré-rempli${glossed > 1 ? "s" : ""} depuis le dictionnaire ; le reste sur « (à traduire) ».`
                : "Front = mot, verso = « (à traduire) ». Édite-les dans le deck.") +
              (skipped > 0
                ? ` ${skipped} déjà présent${skipped > 1 ? "s" : ""} ignoré${skipped > 1 ? "s" : ""}.`
                : ""),
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
  const canCreateCards = deckId !== null && wordsToCreate.length > 0 && !createCards.isPending;

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
              <Select
                value={language}
                onValueChange={(value) => setLanguage(value as LanguageValue)}
              >
                <SelectTrigger id={langSelectId}>
                  <SelectValue placeholder="Choisir une langue" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Dictionnaire hors-ligne anglais → français. Pour une autre langue, les mots inconnus
                utilisent la définition générée par l'IA.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={deckSelectId}>Deck cible (pour les cartes)</Label>
              <Select
                value={deckId === null ? NO_DECK : String(deckId)}
                onValueChange={(value) => setDeckId(value === NO_DECK ? null : Number(value))}
              >
                <SelectTrigger id={deckSelectId}>
                  <SelectValue placeholder="— Choisir un deck —" />
                </SelectTrigger>
                <SelectContent>
                  {decks.map((deck) => (
                    <SelectItem key={deck.id} value={String(deck.id)}>
                      {deck.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            {/* Stats line — announced politely so SR users hear coverage shift. */}
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
              data-testid="reading-stats"
              aria-live="polite"
            >
              <span className="text-muted-foreground">
                <strong className="text-foreground">{stats.unknown - stats.learning}</strong>{" "}
                inconnus · <strong className="text-foreground">{stats.learning}</strong> en cours ·{" "}
                <strong className="text-foreground">{stats.known}</strong> connus /{" "}
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

            {/*
              The text itself. Each word is a `WordLookupPopover` trigger:
              click (or Enter/Space) opens an accessible dialog with the
              definition / IPA / FR gloss, a TTS speaker, a per-word « créer une
              carte » and — for unknown words — an « Générer avec l'IA »
              fallback. Status cycling (new → learning → known) lives in the
              popover footer so it stays reachable by keyboard and screen
              readers. The trigger carries an aria-label conveying the reading
              status, which the colour alone cannot announce.
            */}
            <p
              className="whitespace-pre-wrap break-words text-base leading-8"
              data-testid="reading-text"
            >
              {tokens.map((token) => {
                if (!token.isWord) {
                  return <span key={token.key}>{token.raw}</span>;
                }
                const word = token.normalized;
                const status = statusOf(word);
                return (
                  <WordLookupPopover
                    key={token.key}
                    word={word}
                    entry={entryOf(word)}
                    open={openKey === token.key}
                    onOpenChange={(next) => setOpenKey(next ? token.key : null)}
                    onSpeak={handleSpeak}
                    speakLoading={synthesize.isPending}
                    onCreateCard={handleCreateCardFromEntry}
                    onAiLookup={handleAiLookup}
                    aiLoading={aiLoadingWord === word}
                    aiError={aiErrors[word] ?? null}
                    triggerLabel={`${token.raw} — ${STATUS_LABEL[status]}. Voir la définition.`}
                    className={cn("rounded px-0.5 transition-colors", statusClasses(status))}
                    footer={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-center"
                        onClick={() => handleWordClick(word)}
                        data-testid="cycle-status-button"
                      >
                        <RotateCw />
                        Marquer {STATUS_LABEL[nextStatus(status)]}
                      </Button>
                    }
                  >
                    <span data-testid="reading-word" data-word={word} data-status={status}>
                      {token.raw}
                    </span>
                  </WordLookupPopover>
                );
              })}
            </p>

            {/* biome-ignore lint/a11y/useMediaCaption: TTS playback of single words — no captions available. */}
            <audio ref={audioRef} preload="none" className="hidden" />

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
                    Créer {wordsToCreate.length} carte{wordsToCreate.length > 1 ? "s" : ""}
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                {learningWords.length === 0
                  ? "Marque des mots « en cours » pour en faire des cartes."
                  : deckId === null
                    ? "Choisis d'abord un deck cible ci-dessus."
                    : wordsToCreate.length === 0
                      ? `Les ${learningWords.length} mot${
                          learningWords.length > 1 ? "s" : ""
                        } « en cours » sont déjà dans ce deck.`
                      : `${wordsToCreate.length} mot${
                          wordsToCreate.length > 1 ? "s" : ""
                        } « en cours » prêt${wordsToCreate.length > 1 ? "s" : ""}${
                          duplicateCount > 0
                            ? ` (${duplicateCount} déjà présent${duplicateCount > 1 ? "s" : ""} ignoré${
                                duplicateCount > 1 ? "s" : ""
                              })`
                            : ""
                        }.`}
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
