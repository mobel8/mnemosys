/**
 * AI flashcard generator — full editor flow.
 *
 * Pipeline:
 *   1. User picks a deck + source (raw text or PDF path) + a few knobs
 *      (max cards, language).
 *   2. We call `useGenerateCardsFromText` or `useGenerateCardsFromPdf` to
 *      get a `GeneratedCard[]` from Claude.
 *   3. Cards land in local `drafts` state, each with a stable client-side
 *      id so the user can rearrange / edit / drop them without losing
 *      React keys.
 *   4. "Valider et créer N cartes" walks `drafts` **sequentially** through
 *      `useCreateNote.mutateAsync` — parallel calls would spam the DB and
 *      lose deterministic ordering, which matters for downstream review
 *      sessions.
 *
 * Resilience policy:
 *   - 0 cartes générées → inline message, no toast spam.
 *   - Anthropic API key missing → caught from the error message, with a
 *     CTA toward `/settings`.
 *   - PDF tab without picked file → button disabled; we never call the
 *     backend with an empty path.
 *
 * The shadcn `Select` component isn't part of this project's UI kit, so
 * the deck + language pickers fall back to native `<select>` elements
 * styled to match the `Input` component.
 */

import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import {
  useCreateNote,
  useCritiqueCards,
  useDecks,
  useGenerateCardElaboration,
  useGenerateCardsFromPdf,
  useGenerateCardsFromText,
} from "@/lib/queries";
import type { AICardTemplate, CardCritique, GeneratedCard, NoteTemplate } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Max chars accepted in the text-area before we refuse to submit. */
const MAX_TEXT_CHARS = 50_000;
const DEFAULT_MAX_CARDS = 10;
const MAX_CARDS_HARD_CAP = 50;

/** Language picker options. Value is the locale hint sent to the backend. */
const LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

type LanguageValue = (typeof LANGUAGES)[number]["value"];
type SourceTab = "text" | "pdf";

/**
 * Local working copy of a `GeneratedCard`. We carry an `id` so React keys
 * stay stable through edits / removals (the backend returns no id of its
 * own — generation is stateless).
 *
 * Vague 5 — `why` / `example` are optional elaborations the user opts into
 * via the « enrich with explanations » checkbox. Both stay as plain strings
 * inside `fields` when the note is persisted; an empty string means
 * « nothing to display » to the review UI.
 */
interface CardDraft {
  id: string;
  template: AICardTemplate;
  front: string;
  back: string;
  text: string;
  tags: string[];
  why: string;
  example: string;
  /**
   * Vague 13 — quality verdict from the optional « critic » pass. `undefined`
   * means the card was never critiqued (toggle off, or critique failed). When
   * present, `score` is in `[0, 1]`; `suggestedFix` is a one-click rewrite the
   * critic proposed for low-scoring cards (`null` when nothing to apply).
   */
  critique?: {
    score: number;
    issues: string[];
    suggestedFix: GeneratedCard | null;
  };
}

function draftFromGenerated(card: GeneratedCard, index: number): CardDraft {
  const fields = card.fields;
  const front = typeof fields.front === "string" ? fields.front : "";
  const back = typeof fields.back === "string" ? fields.back : "";
  const text = typeof fields.text === "string" ? fields.text : "";
  const why = typeof fields.why === "string" ? fields.why : "";
  const example = typeof fields.example === "string" ? fields.example : "";
  return {
    // `index` keeps ids ordered when multiple drafts are minted in the same tick.
    id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    template: card.template,
    front,
    back,
    text,
    tags: Array.isArray(card.tags) ? card.tags : [],
    why,
    example,
  };
}

/** Concatenate a draft into the « card text » the elaboration prompt expects. */
function draftToCardText(draft: CardDraft): string {
  if (draft.template === "cloze") return draft.text.trim();
  return `${draft.front.trim()}\n\n${draft.back.trim()}`.trim();
}

/**
 * Vague 13 — rebuild a `GeneratedCard` from a local draft so the critic sees
 * exactly the card the user is about to persist (including any edits made
 * before requesting the quality check).
 */
function draftToGeneratedCard(draft: CardDraft): GeneratedCard {
  const fields: Record<string, unknown> =
    draft.template === "cloze"
      ? { text: draft.text.trim() }
      : { front: draft.front.trim(), back: draft.back.trim() };
  return { template: draft.template, fields, tags: draft.tags };
}

/** Below this critic score a card is flagged « to improve » in the UI. */
const QUALITY_THRESHOLD = 0.7;

/**
 * Map an `AICardTemplate` to the `NoteTemplate` accepted by `create_note`.
 * The backend currently supports a direct 1:1 mapping for both shapes.
 */
function toNoteTemplate(template: AICardTemplate): NoteTemplate {
  return template === "cloze" ? "cloze" : "basic";
}

function isApiKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /api[_ ]?key|anthropic|unauthor/i.test(msg);
}

export function AiGenerator() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  // Form state ------------------------------------------------------------
  const [deckId, setDeckId] = useState<number | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>("text");
  const [text, setText] = useState("");
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [maxCards, setMaxCards] = useState<number>(DEFAULT_MAX_CARDS);
  const [language, setLanguage] = useState<LanguageValue>("fr");
  /**
   * Vague 5 — opt-in IA augmentée. When `true`, each generated card gets a
   * follow-up Claude call to mint a `{ why, example }` enrichment. Stays
   * off by default because the extra round-trips multiply the cost.
   */
  const [includeElaboration, setIncludeElaboration] = useState(false);
  const [isElaborating, setIsElaborating] = useState(false);
  /**
   * Vague 13 — opt-in Generator → Critic pass. When `true`, after generation
   * a second Claude call scores each card and may propose corrections. Off by
   * default: it's an extra round-trip the user explicitly asks for.
   */
  const [includeCritique, setIncludeCritique] = useState(false);
  const [isCritiquing, setIsCritiquing] = useState(false);

  // Drafts (the validation queue) ----------------------------------------
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [isCreatingAll, setIsCreatingAll] = useState(false);

  // Initialise deckId once decks load. We pick the first deck so the form
  // is immediately usable; the user can still pick another one. Using an
  // effect (rather than a setState during render) avoids React's
  // "Cannot update a component while rendering" warning.
  useEffect(() => {
    if (deckId !== null) return;
    const first = decks[0];
    if (first) setDeckId(first.id);
  }, [deckId, decks]);

  // Mutations -------------------------------------------------------------
  const genText = useGenerateCardsFromText();
  const genPdf = useGenerateCardsFromPdf();
  const genElaboration = useGenerateCardElaboration();
  const critiqueCards = useCritiqueCards();
  const createNote = useCreateNote();

  const isGenerating = genText.isPending || genPdf.isPending;

  // Stable ids for accessible label/control wiring.
  const deckSelectId = useId();
  const textInputId = useId();
  const maxCardsId = useId();
  const langSelectId = useId();
  const elaborationCheckboxId = useId();
  const critiqueCheckboxId = useId();

  // ----- Handlers --------------------------------------------------------

  async function handlePickPdf() {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!picked) return; // user cancelled
      const path = typeof picked === "string" ? picked : picked[0];
      if (path) setPdfPath(path);
    } catch (err) {
      toast({
        title: "Sélection impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  function handleGenerationError(err: unknown) {
    if (isApiKeyError(err)) {
      toast({
        title: "Clé API Anthropic manquante",
        description: "Configure ta clé dans les paramètres avant de générer des cartes.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Génération impossible",
      description: err instanceof Error ? err.message : String(err),
      variant: "destructive",
    });
  }

  async function handleGenerate() {
    const safeMaxCards = clampMaxCards(maxCards);
    try {
      const cards =
        sourceTab === "text"
          ? await genText.mutateAsync({
              text: text.trim(),
              maxCards: safeMaxCards,
              language,
            })
          : await genPdf.mutateAsync({
              // Cast guarded by `canGenerate` — button is disabled when null.
              pdfPath: pdfPath ?? "",
              maxCards: safeMaxCards,
              language,
            });
      const nextDrafts = cards.map((c, i) => draftFromGenerated(c, i));
      setDrafts(nextDrafts);
      if (nextDrafts.length === 0) {
        toast({
          title: "Aucune carte générée",
          description:
            "Claude n'a rien renvoyé pour cette source. Essaie un texte plus long ou un autre extrait.",
        });
        return;
      }
      toast({
        title: "Cartes générées",
        description: `${nextDrafts.length} carte${nextDrafts.length > 1 ? "s" : ""} prête${nextDrafts.length > 1 ? "s" : ""} à être validée${nextDrafts.length > 1 ? "s" : ""}.`,
      });

      // Vague 5 — opt-in elaboration pass. Each card gets an independent
      // Claude call so a single failure doesn't tank the whole batch; we
      // patch successful enrichments back into `drafts` as they land.
      if (includeElaboration) {
        await enrichDraftsWithElaboration(nextDrafts);
      }

      // Vague 13 — opt-in critic pass. Runs after elaboration so the reviewer
      // sees the same cards the user will. One batched call (not per-card),
      // and a failure is purely additive: drafts stay usable without scores.
      if (includeCritique) {
        await critiqueDrafts(nextDrafts);
      }
    } catch (err) {
      handleGenerationError(err);
    }
  }

  /**
   * Vague 13 — Generator → Critic pass. Sends the batch (in draft order, so
   * each verdict's `card_index` lines up with our local list) to Claude and
   * patches the returned scores / suggested fixes onto the matching drafts.
   * Failures are swallowed into a single toast — the critic is advisory.
   */
  async function critiqueDrafts(targetDrafts: CardDraft[]): Promise<void> {
    if (targetDrafts.length === 0) return;
    setIsCritiquing(true);
    try {
      const cards = targetDrafts.map(draftToGeneratedCard);
      const verdicts = await critiqueCards.mutateAsync({ cards });
      // Index verdicts by their reported `card_index` for an O(1) join.
      const byIndex = new Map<number, CardCritique>();
      for (const v of verdicts) byIndex.set(v.card_index, v);
      setDrafts((prev) =>
        prev.map((d) => {
          const pos = targetDrafts.findIndex((t) => t.id === d.id);
          const verdict = pos >= 0 ? byIndex.get(pos) : undefined;
          if (!verdict) return d;
          return {
            ...d,
            critique: {
              score: verdict.score,
              issues: Array.isArray(verdict.issues) ? verdict.issues : [],
              suggestedFix: verdict.suggested_fix,
            },
          };
        }),
      );
      const flagged = verdicts.filter((v) => v.score < QUALITY_THRESHOLD).length;
      toast({
        title: "Vérification qualité terminée",
        description:
          flagged === 0
            ? `${verdicts.length} carte${verdicts.length > 1 ? "s" : ""} évaluée${verdicts.length > 1 ? "s" : ""} — aucune correction suggérée.`
            : `${flagged} carte${flagged > 1 ? "s" : ""} à améliorer (correction proposée).`,
      });
    } catch (err) {
      console.warn("[ai] critique pass failed", err);
      toast({
        title: "Vérification qualité indisponible",
        description: "Les cartes restent utilisables sans score de qualité.",
        variant: "destructive",
      });
    } finally {
      setIsCritiquing(false);
    }
  }

  /** Apply a critic's `suggestedFix` onto a draft, then clear its verdict. */
  function applyCritiqueFix(id: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id || !d.critique?.suggestedFix) return d;
        const fix = d.critique.suggestedFix;
        const fields = fix.fields;
        const front = typeof fields.front === "string" ? fields.front : d.front;
        const back = typeof fields.back === "string" ? fields.back : d.back;
        const text = typeof fields.text === "string" ? fields.text : d.text;
        return {
          ...d,
          template: fix.template,
          front: fix.template === "basic" ? front : d.front,
          back: fix.template === "basic" ? back : d.back,
          text: fix.template === "cloze" ? text : d.text,
          tags: Array.isArray(fix.tags) ? fix.tags : d.tags,
          // Drop the verdict once applied — the card now reflects the fix.
          critique: undefined,
        };
      }),
    );
    toast({ title: "Correction appliquée" });
  }

  async function enrichDraftsWithElaboration(targetDrafts: CardDraft[]): Promise<void> {
    if (targetDrafts.length === 0) return;
    setIsElaborating(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const draft of targetDrafts) {
        const cardText = draftToCardText(draft);
        if (cardText.length === 0) {
          failed += 1;
          continue;
        }
        try {
          const enrichment = await genElaboration.mutateAsync({
            cardText,
            language,
          });
          setDrafts((prev) =>
            prev.map((d) =>
              d.id === draft.id ? { ...d, why: enrichment.why, example: enrichment.example } : d,
            ),
          );
          succeeded += 1;
        } catch (err) {
          // Elaboration is purely additive — surface a single aggregated
          // toast at the end rather than spamming the user per-card.
          console.warn("[ai] elaboration failed for one card", err);
          failed += 1;
        }
      }
    } finally {
      setIsElaborating(false);
    }
    if (succeeded > 0) {
      toast({
        title: "Élaborations ajoutées",
        description:
          failed === 0
            ? `${succeeded} carte${succeeded > 1 ? "s" : ""} enrichie${succeeded > 1 ? "s" : ""} avec « Pourquoi » + « Exemple ».`
            : `${succeeded} enrichi${succeeded > 1 ? "es" : "e"}, ${failed} échec${failed > 1 ? "s" : ""}.`,
      });
    } else if (failed > 0) {
      toast({
        title: "Élaborations échouées",
        description: "Aucune élaboration n'a pu être générée pour ce lot.",
        variant: "destructive",
      });
    }
  }

  function updateDraft(id: string, patch: Partial<CardDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  function resetAll() {
    setDrafts([]);
    setText("");
    setPdfPath(null);
  }

  async function handleCreateAll() {
    if (deckId === null || drafts.length === 0) return;
    setIsCreatingAll(true);
    let created = 0;
    const failures: string[] = [];
    try {
      // Sequential — see file header for the rationale.
      for (const draft of drafts) {
        const baseFields: Record<string, unknown> =
          draft.template === "cloze"
            ? { text: draft.text.trim() }
            : { front: draft.front.trim(), back: draft.back.trim() };
        // Vague 5 — only attach why/example when they actually carry text.
        // `validate_fields` ignores unknown keys for basic/cloze, so this
        // is safe to do unconditionally, but skipping empties keeps notes
        // free of junk strings for cards the user opted out of enriching.
        const fields: Record<string, unknown> = { ...baseFields };
        if (draft.why.trim().length > 0) fields.why = draft.why.trim();
        if (draft.example.trim().length > 0) fields.example = draft.example.trim();
        try {
          await createNote.mutateAsync({
            deckId,
            template: toNoteTemplate(draft.template),
            fields,
            tags: draft.tags,
          });
          created += 1;
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setIsCreatingAll(false);
    }
    if (created > 0) {
      toast({
        title: `${created} carte${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}`,
        description:
          failures.length === 0
            ? "Toutes les cartes ont été ajoutées au deck."
            : `${failures.length} échec${failures.length > 1 ? "s" : ""} (voir console).`,
      });
      // Clear out the queue so the user doesn't double-submit.
      setDrafts([]);
    }
    if (failures.length > 0 && created === 0) {
      toast({
        title: "Aucune carte créée",
        description: failures[0] ?? "Échec inconnu.",
        variant: "destructive",
      });
    }
  }

  // ----- Derived flags ---------------------------------------------------

  const trimmedTextLen = text.trim().length;
  const textTooLong = text.length > MAX_TEXT_CHARS;

  const canGenerate = (() => {
    if (deckId === null) return false;
    if (isGenerating) return false;
    if (sourceTab === "text") return trimmedTextLen > 0 && !textTooLong;
    return pdfPath !== null;
  })();

  return (
    <div className="space-y-6">
      {/* ---------- Config Card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Source &amp; paramètres
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Deck picker */}
          <div className="space-y-2">
            <Label htmlFor={deckSelectId}>Deck cible</Label>
            {decksQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement des decks…</p>
            ) : decks.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                Aucun deck disponible.{" "}
                <Link
                  to="/"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Crée d'abord un deck
                </Link>{" "}
                pour pouvoir générer des cartes.
              </div>
            ) : (
              <select
                id={deckSelectId}
                value={deckId ?? ""}
                onChange={(e) => setDeckId(Number(e.target.value))}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Source tabs */}
          <Tabs value={sourceTab} onValueChange={(next) => setSourceTab(next as SourceTab)}>
            <TabsList>
              <TabsTrigger value="text">Texte</TabsTrigger>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-2">
              <Label htmlFor={textInputId}>Texte source</Label>
              <Textarea
                id={textInputId}
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Colle ici un cours, un article…"
                className={cn(
                  "min-h-[180px] font-mono text-sm",
                  textTooLong && "border-destructive",
                )}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {text.length.toLocaleString("fr-FR")} / {MAX_TEXT_CHARS.toLocaleString("fr-FR")}{" "}
                  caractères
                </span>
                {textTooLong && (
                  <span className="text-destructive">Texte trop long, réduis-le.</span>
                )}
              </div>
            </TabsContent>

            <TabsContent value="pdf" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={handlePickPdf}>
                  <FileText className="h-4 w-4" />
                  Choisir un PDF
                </Button>
                {pdfPath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPdfPath(null)}
                    aria-label="Effacer le PDF sélectionné"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {pdfPath ? (
                <p className="break-all rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {pdfPath}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Aucun fichier sélectionné. Choisis un PDF lisible (pas une image scannée).
                </p>
              )}
            </TabsContent>
          </Tabs>

          {/* Knobs row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={maxCardsId}>Nombre de cartes max</Label>
              <Input
                id={maxCardsId}
                type="number"
                min={1}
                max={MAX_CARDS_HARD_CAP}
                value={maxCards}
                onChange={(e) => setMaxCards(parseIntSafe(e.target.value, DEFAULT_MAX_CARDS))}
              />
              <p className="text-xs text-muted-foreground">Entre 1 et {MAX_CARDS_HARD_CAP}.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={langSelectId}>Langue</Label>
              <select
                id={langSelectId}
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageValue)}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                {LANGUAGES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/20 p-3">
            <input
              id={elaborationCheckboxId}
              type="checkbox"
              checked={includeElaboration}
              onChange={(e) => setIncludeElaboration(e.target.checked)}
              disabled={isGenerating || isElaborating}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <div className="space-y-0.5">
              <Label htmlFor={elaborationCheckboxId} className="cursor-pointer text-sm">
                Inclure « Pourquoi » et « Exemples » auto-générés
              </Label>
              <p className="text-xs text-muted-foreground">
                Pour chaque carte, un appel supplémentaire à Claude produit une justification courte
                (elaborative interrogation) et 1-2 exemples concrets — coût IA légèrement plus
                élevé.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/20 p-3">
            <input
              id={critiqueCheckboxId}
              type="checkbox"
              checked={includeCritique}
              onChange={(e) => setIncludeCritique(e.target.checked)}
              disabled={isGenerating || isElaborating || isCritiquing}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <div className="space-y-0.5">
              <Label htmlFor={critiqueCheckboxId} className="cursor-pointer text-sm">
                Vérification qualité IA (2e passe critic)
              </Label>
              <p className="text-xs text-muted-foreground">
                Après génération, un relecteur IA évalue chaque carte (factualité, clarté,
                atomicité) et propose une correction pour les cartes faibles — pipeline Generator →
                Critic, coût IA supplémentaire.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate || isElaborating || isCritiquing}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Génération…
                </>
              ) : isElaborating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enrichissement…
                </>
              ) : isCritiquing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Vérification…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Générer
                </>
              )}
            </Button>
            {drafts.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={resetAll}
                disabled={isCreatingAll || isGenerating || isElaborating || isCritiquing}
              >
                Réinitialiser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------- Drafts list ---------- */}
      {drafts.length > 0 && (
        <section aria-labelledby="ai-drafts-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="ai-drafts-heading" className="text-lg font-semibold tracking-tight">
              Cartes proposées ({drafts.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Édite ou retire les cartes avant validation.
            </p>
          </div>

          <ol className="space-y-3">
            {drafts.map((draft, index) => (
              <li key={draft.id}>
                <DraftCard
                  draft={draft}
                  index={index}
                  disabled={isCreatingAll}
                  onChange={(patch) => updateDraft(draft.id, patch)}
                  onRemove={() => removeDraft(draft.id)}
                  onApplyFix={() => applyCritiqueFix(draft.id)}
                />
              </li>
            ))}
          </ol>

          <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDrafts([])}
              disabled={isCreatingAll}
            >
              <Trash2 className="h-4 w-4" />
              Tout rejeter
            </Button>
            <Button
              type="button"
              onClick={handleCreateAll}
              disabled={isCreatingAll || deckId === null}
            >
              {isCreatingAll ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Création…
                </>
              ) : (
                <>
                  Valider et créer {drafts.length} carte{drafts.length > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </section>
      )}

      {/* ---------- Empty state hint ---------- */}
      {drafts.length === 0 && !isGenerating && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <p>
              Les cartes générées apparaîtront ici. Si la clé API Anthropic n'est pas configurée,
              ajoute-la dans{" "}
              <Link
                to="/settings"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                les paramètres
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: <DraftCard /> — one editable line in the validation queue.
// ---------------------------------------------------------------------------

interface DraftCardProps {
  draft: CardDraft;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<CardDraft>) => void;
  onRemove: () => void;
  onApplyFix: () => void;
}

function DraftCard({ draft, index, disabled, onChange, onRemove, onApplyFix }: DraftCardProps) {
  const frontId = useId();
  const backId = useId();
  const textId = useId();
  const whyId = useId();
  const exampleId = useId();
  const hasElaboration = draft.why.length > 0 || draft.example.length > 0;
  const critique = draft.critique;
  const scorePct = critique ? Math.round(critique.score * 100) : null;
  const isLowQuality = critique != null && critique.score < QUALITY_THRESHOLD;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              #{index + 1}
            </Badge>
            <Badge variant={draft.template === "cloze" ? "default" : "outline"}>
              {draft.template === "cloze" ? "Cloze" : "Basic"}
            </Badge>
            {hasElaboration && (
              <Badge variant="outline" className="border-primary/40 text-primary">
                Enrichi
              </Badge>
            )}
            {critique != null && (
              <Badge
                data-testid={`critique-badge-${index}`}
                variant={isLowQuality ? "destructive" : "secondary"}
                className="font-mono"
                title={
                  critique.issues.length > 0 ? critique.issues.join("\n") : "Aucun problème détecté"
                }
              >
                Qualité {scorePct}%
              </Badge>
            )}
            {draft.tags.map((tag) => {
              // Vague 17 — PDF provenance tag (`source:<file>`) gets a distinct
              // pill with a document icon so the learner spots the citation.
              const source = parseSourceTag(tag);
              return source !== null ? (
                <Badge
                  key={tag}
                  variant="outline"
                  className="gap-1 border-primary/40 font-normal text-primary"
                  data-testid="draft-source-badge"
                  title={`Source : ${source}`}
                >
                  <FileText className="h-3 w-3" aria-hidden />
                  {source}
                </Badge>
              ) : (
                <Badge key={tag} variant="outline" className="font-normal">
                  {tag}
                </Badge>
              );
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Rejeter la carte ${index + 1}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {draft.template === "basic" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={frontId} className="text-xs uppercase tracking-wide">
                Front
              </Label>
              <Textarea
                id={frontId}
                rows={3}
                value={draft.front}
                onChange={(e) => onChange({ front: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={backId} className="text-xs uppercase tracking-wide">
                Back
              </Label>
              <Textarea
                id={backId}
                rows={3}
                value={draft.back}
                onChange={(e) => onChange({ back: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={textId} className="text-xs uppercase tracking-wide">
              Texte cloze
            </Label>
            <Textarea
              id={textId}
              rows={4}
              value={draft.text}
              onChange={(e) => onChange({ text: e.target.value })}
              disabled={disabled}
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Syntaxe : <code>{`{{c1::mot caché}}`}</code> — utilise <code>c2</code>,{" "}
              <code>c3</code> pour plusieurs cartes à partir du même texte.
            </p>
          </div>
        )}

        {hasElaboration && (
          <div className="grid gap-3 rounded-md border border-dashed bg-muted/10 p-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={whyId} className="text-xs uppercase tracking-wide">
                Pourquoi
              </Label>
              <Textarea
                id={whyId}
                rows={2}
                value={draft.why}
                onChange={(e) => onChange({ why: e.target.value })}
                disabled={disabled}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={exampleId} className="text-xs uppercase tracking-wide">
                Exemple
              </Label>
              <Textarea
                id={exampleId}
                rows={2}
                value={draft.example}
                onChange={(e) => onChange({ example: e.target.value })}
                disabled={disabled}
                className="text-sm"
              />
            </div>
          </div>
        )}

        {critique?.suggestedFix != null && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="space-y-0.5 text-xs">
              <p className="font-medium text-destructive">Le relecteur suggère une correction</p>
              {critique.issues.length > 0 && (
                <p className="text-muted-foreground">{critique.issues.join(" · ")}</p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={onApplyFix}
              data-testid={`apply-fix-${index}`}
            >
              Appliquer la correction
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Vague 17 — extract the filename from a PaperQA-style `source:<file>` tag.
 * Returns the (trimmed, non-empty) filename, or `null` when `tag` is an
 * ordinary topical tag. Used to render the provenance pill distinctly.
 */
function parseSourceTag(tag: string): string | null {
  if (!tag.startsWith("source:")) return null;
  const value = tag.slice("source:".length).trim();
  return value.length > 0 ? value : null;
}

/** Parse an integer from a text-input value, falling back to `fallback`. */
function parseIntSafe(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Clamp to [1, MAX_CARDS_HARD_CAP]; fall back to the default on garbage input. */
function clampMaxCards(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CARDS;
  if (value < 1) return 1;
  if (value > MAX_CARDS_HARD_CAP) return MAX_CARDS_HARD_CAP;
  return Math.floor(value);
}
