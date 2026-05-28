/**
 * Visual representation of the card currently being graded.
 *
 * Handles four templates:
 *   - "basic"          → `{ front, back }`
 *   - "basic_reverse"  → `{ front, back }` (rendered identically; the back
 *                        side is created server-side as a separate card row,
 *                        so from the UI's perspective there's no asymmetry).
 *   - "cloze"          → `{ text }` with `{{c1::answer}}` markers. The
 *                        first cloze deletion is hidden on the question
 *                        side and highlighted on the answer side.
 *   - "occlusion"      → image + N masks (one card per mask). Delegated to
 *                        `<OcclusionReviewView>`; we *skip* the flip animation
 *                        for this template because the visual diff between
 *                        question and answer is the mask overlay itself.
 *   - "illness_script" → clinical fiche (Vague 14). Recto = condition, verso =
 *                        the four structured sections (epidemiology /
 *                        pathophysiology / clinical / management).
 *   - "refutation"     → misconception confrontation (Vague 14). Recto =
 *                        « Vrai ou faux ? {misconception} », verso = « FAUX.
 *                        {correct} » + optional explanation.
 *   - "worked_example" → faded worked example (Vague 15). Recto = problem,
 *                        verso reveals solution steps progressively (click
 *                        « Étape suivante ») then the final answer.
 *
 * Animation: a horizontal flip via framer-motion. The whole front+back
 * payload is wrapped in a `motion.div` whose `rotateY` toggles between
 * 0 and 180. Two faces are stacked with `backface-visibility: hidden`,
 * so the back appears as the parent rotates past 90deg.
 *
 * Cards advance with an entry/exit slide handled by the parent through
 * `AnimatePresence`; this component only owns the flip.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { OcclusionReviewView } from "@/components/OcclusionReviewView";
import { TtsButton } from "@/components/TtsButton";
import {
  similarityScore,
  TypeAnswer,
  type TypeAnswerVerdict,
  verdictFor,
} from "@/components/TypeAnswer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VoiceAnswerButton } from "@/components/VoiceAnswerButton";
import type { Note } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/**
 * Strip cloze markup so TTS narrates plain prose. Replaces `{{c1::answer}}`
 * (with optional `::hint`) by the answer, and `{{c2::...}}` etc by the answer
 * too — synthesising the same text on both faces is fine because the audio
 * cache key includes the text, so question vs answer use distinct entries.
 */
function clozeToSpoken(text: string, mode: "question" | "answer"): string {
  // Re-create a local regex to avoid sharing `lastIndex` with the renderer above.
  const re = /\{\{c(\d+)::([^}]+?)(?:::([^}]+?))?\}\}/g;
  let firstNumber: number | null = null;
  return text.replace(re, (_full, num: string, answer: string, hint: string | undefined) => {
    const n = Number(num);
    if (firstNumber === null) firstNumber = n;
    // On the question face, blank out the *first* cloze; otherwise reveal.
    if (mode === "question" && n === firstNumber) {
      return hint ?? "blank";
    }
    return answer;
  });
}

type Phase = "question" | "answer" | "submitting" | "done";

interface ReviewCardProps {
  note: Note;
  phase: Phase;
  /** 0-based ordinal of the underlying card row. Only meaningful for
   *  templates whose notes mint multiple cards (cloze, occlusion). */
  cardOrd?: number;
  /** When `true` and the note is basic/basic_reverse, an inline input
   *  asks the learner to type the expected back side before the flip. */
  typeTheAnswerEnabled?: boolean;
  /** Vague 8 — Whisper Mode Review. When `true` (and the note is
   *  basic/basic_reverse) a Mic button captures a voice answer instead of
   *  the typed input. Mutually exclusive with `typeTheAnswerEnabled` — voice
   *  wins because the typing alternative is always available offline. */
  voiceAnswerEnabled?: boolean;
  /** Fired when the learner submits a typed answer. Surfaces the
   *  normalised similarity score so the parent can log it / nudge a
   *  rating decision. */
  onTypedAnswer?: (typed: string, score: number, verdict: TypeAnswerVerdict) => void;
  /**
   * Vague 5 — interleaved review mode. When `deckName` is provided, the
   * card shows a small badge with the deck of origin so the learner stays
   * oriented as the queue mixes contexts.
   */
  deckName?: string;
}

interface ElaborationFields {
  why: string;
  example: string;
}

function getElaboration(note: Note): ElaborationFields {
  const why = typeof note.fields.why === "string" ? note.fields.why.trim() : "";
  const example = typeof note.fields.example === "string" ? note.fields.example.trim() : "";
  return { why, example };
}

const CLOZE_REGEX = /\{\{c(\d+)::([^}]+?)(?:::([^}]+?))?\}\}/g;

interface ClozeRender {
  /** First-cloze number we hid on the question side. `null` for non-cloze notes. */
  clozeNumber: number | null;
  /** HTML-as-string for the question face (cloze hidden). */
  questionHtml: string;
  /** HTML-as-string for the answer face (cloze highlighted). */
  answerHtml: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCloze(text: string): ClozeRender {
  let firstClozeNumber: number | null = null;
  const collected: number[] = [];

  CLOZE_REGEX.lastIndex = 0;
  let match = CLOZE_REGEX.exec(text);
  while (match !== null) {
    const n = Number(match[1]);
    if (!collected.includes(n)) collected.push(n);
    if (firstClozeNumber === null) firstClozeNumber = n;
    match = CLOZE_REGEX.exec(text);
  }

  const renderFor = (mode: "question" | "answer"): string => {
    let cursor = 0;
    let out = "";
    CLOZE_REGEX.lastIndex = 0;
    let m = CLOZE_REGEX.exec(text);
    while (m !== null) {
      out += escapeHtml(text.slice(cursor, m.index));
      const n = Number(m[1]);
      const answer = m[2] ?? "";
      const hint = m[3];
      // Hide only the *first* cloze on the question side. Other clozes stay
      // visible so the user has surrounding context.
      if (mode === "question" && n === firstClozeNumber) {
        out += `<span class="rounded bg-muted px-2 py-0.5 text-muted-foreground">[${hint ? escapeHtml(hint) : "..."}]</span>`;
      } else if (mode === "answer" && n === firstClozeNumber) {
        out += `<span class="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">${escapeHtml(answer)}</span>`;
      } else {
        out += escapeHtml(answer);
      }
      cursor = m.index + m[0].length;
      m = CLOZE_REGEX.exec(text);
    }
    out += escapeHtml(text.slice(cursor));
    return out;
  };

  return {
    clozeNumber: firstClozeNumber,
    questionHtml: renderFor("question"),
    answerHtml: renderFor("answer"),
  };
}

interface BasicFields {
  front: string;
  back: string;
  /** Vague 10 — optional language-note hint, shown under the answer. */
  hint?: string;
}

function getBasicFields(note: Note, cardOrd = 0): BasicFields {
  // Vague 10 — sentence / bidirectional notes store `source` + `target`
  // instead of `front` / `back`. Card ord 0 quizzes source→target; ord 1
  // (bidirectional only) flips to target→source.
  if (note.template === "sentence" || note.template === "bidirectional") {
    const source = typeof note.fields.source === "string" ? note.fields.source : "";
    const target = typeof note.fields.target === "string" ? note.fields.target : "";
    const hint = typeof note.fields.hint === "string" ? note.fields.hint : "";
    const reversed = cardOrd === 1;
    return {
      front: reversed ? target : source,
      back: reversed ? source : target,
      hint: hint || undefined,
    };
  }
  const front = typeof note.fields.front === "string" ? note.fields.front : "";
  const back = typeof note.fields.back === "string" ? note.fields.back : "";
  return { front, back };
}

function getClozeText(note: Note): string {
  return typeof note.fields.text === "string" ? note.fields.text : "";
}

/** Vague 14 — pull a trimmed string field, defaulting to "". */
function strField(note: Note, key: string): string {
  const v = note.fields[key];
  return typeof v === "string" ? v.trim() : "";
}

interface IllnessSection {
  label: string;
  value: string;
}

/**
 * Vague 14 — gather the non-empty clinical sections of an illness-script
 * note, in clinical-reasoning order. The recto is always the condition.
 */
function getIllnessSections(note: Note): IllnessSection[] {
  return (
    [
      { label: "Épidémiologie", value: strField(note, "epidemiology") },
      { label: "Physiopathologie", value: strField(note, "pathophysiology") },
      { label: "Clinique", value: strField(note, "clinical") },
      { label: "Prise en charge", value: strField(note, "management") },
    ] as IllnessSection[]
  ).filter((s) => s.value.length > 0);
}

interface WorkedExampleFieldsLocal {
  problem: string;
  steps: string[];
  answer: string;
}

/**
 * Vague 15 — extract a worked-example note's problem, the non-empty solution
 * steps (in order) and the final answer. Mirrors the Rust validation contract.
 */
function getWorkedExample(note: Note): WorkedExampleFieldsLocal {
  const problem = strField(note, "problem");
  const answer = strField(note, "answer");
  const rawSteps = Array.isArray(note.fields.steps) ? note.fields.steps : [];
  const steps = rawSteps
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { problem, steps, answer };
}

export function ReviewCard({
  note,
  phase,
  cardOrd = 0,
  typeTheAnswerEnabled = false,
  voiceAnswerEnabled = false,
  onTypedAnswer,
  deckName,
}: ReviewCardProps) {
  const isAnswer = phase === "answer" || phase === "submitting";
  const isCloze = note.template === "cloze";
  const isOcclusion = note.template === "occlusion";
  // Vague 14 — disciplinary templates render a bespoke recto/verso inside the
  // standard flip card (no front/back string pair).
  const isIllness = note.template === "illness_script";
  const isRefutation = note.template === "refutation";
  const isWorkedExample = note.template === "worked_example";
  // Disciplinary + maths templates all render a bespoke recto/verso inside the
  // standard flip card (no front/back string pair).
  const isDisciplinary = isIllness || isRefutation || isWorkedExample;
  const elaboration = getElaboration(note);
  // Vague 5 — interleaved mode taps into a synthetic `__deck_name` field
  // (injected by `<InterleavedSession />`) when an explicit prop is absent.
  // This keeps the badge plug-and-play without threading another prop
  // through `ReviewSession`'s render path.
  const resolvedDeckName =
    deckName ?? (typeof note.fields.__deck_name === "string" ? note.fields.__deck_name.trim() : "");
  const effectiveDeckName = resolvedDeckName.length > 0 ? resolvedDeckName : undefined;
  // Only render the « Why / Example » strip on the answer face and only
  // when at least one field has content — empty enrichments stay hidden.
  const showElaboration =
    isAnswer && (elaboration.why.length > 0 || elaboration.example.length > 0);
  // Type-the-answer / voice-answer only apply to basic / basic_reverse on
  // the question face. For cloze + occlusion the existing UI already requires
  // retrieval (cloze blank, mask reveal) so adding a typed prompt would
  // double-count. Voice wins over typing when both toggles are on.
  const isBasicTemplate = note.template === "basic" || note.template === "basic_reverse";
  const canPromptAnswer = !isAnswer && !isCloze && !isOcclusion && isBasicTemplate;
  const showVoiceAnswer = voiceAnswerEnabled && canPromptAnswer;
  const showTypeAnswer = !showVoiceAnswer && typeTheAnswerEnabled && canPromptAnswer;

  // Image-occlusion has its own "before/after flip" visual (mask shown vs
  // mask hidden). We render it as a single card without the 3D flip so the
  // image isn't briefly mirrored mid-rotation.
  if (isOcclusion) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={note.id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex w-full flex-col items-center gap-3"
        >
          {effectiveDeckName && <DeckBadge deckName={effectiveDeckName} />}
          <Card className="w-full max-w-2xl">
            <CardContent className="p-6">
              <OcclusionReviewView note={note} cardOrd={cardOrd} showAnswer={isAnswer} />
            </CardContent>
          </Card>
          {showElaboration && <ElaborationStrip elaboration={elaboration} />}
        </motion.div>
      </AnimatePresence>
    );
  }

  const cloze = isCloze ? renderCloze(getClozeText(note)) : null;
  const basic = !isCloze && !isDisciplinary ? getBasicFields(note, cardOrd) : null;

  // Vague 14 — disciplinary recto text + verso JSX. Computed up front so the
  // flip card and the TTS button below can share the same strings.
  const illnessSections = isIllness ? getIllnessSections(note) : [];
  const refutationCorrect = isRefutation ? strField(note, "correct") : "";
  const refutationExplanation = isRefutation ? strField(note, "explanation") : "";
  const workedExample = isWorkedExample ? getWorkedExample(note) : null;
  const disciplinaryFront = isIllness
    ? `Décris le tableau de : ${strField(note, "condition")}`
    : isRefutation
      ? `Vrai ou faux ? ${strField(note, "misconception")}`
      : isWorkedExample
        ? (workedExample?.problem ?? "")
        : "";
  const disciplinaryBackSpoken = isIllness
    ? illnessSections.map((s) => `${s.label}. ${s.value}`).join(" ")
    : isRefutation
      ? `Faux. ${refutationCorrect}${refutationExplanation ? `. ${refutationExplanation}` : ""}`
      : isWorkedExample && workedExample
        ? `${workedExample.steps.join(". ")}. Réponse : ${workedExample.answer}`
        : "";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={note.id}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -40 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex w-full flex-col items-center justify-center gap-4"
      >
        {effectiveDeckName && <DeckBadge deckName={effectiveDeckName} />}
        <div
          className={cn(
            "relative w-full max-w-2xl",
            // Perspective so the rotateY actually looks 3D.
            "[perspective:1500px]",
          )}
        >
          <motion.div
            className="relative w-full"
            initial={false}
            animate={{ rotateY: isAnswer ? 180 : 0 }}
            // GPU transform (rotateY) — kept snappy so reveal feels instant.
            // A full 3D flip below ~150ms reads as a jump-cut and loses the
            // front→back spatial cue, so we sit just above the 100ms target.
            transition={{ duration: 0.18, ease: "easeInOut" }}
            style={{ transformStyle: "preserve-3d" }}
          >
            {/* Front (question) face */}
            <Card
              className={cn(
                "min-h-[280px] w-full",
                // Stack faces: the back is absolutely positioned over the front.
                "relative",
              )}
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
              aria-hidden={isAnswer ? true : undefined}
            >
              <div className="absolute right-3 top-3 z-10">
                <TtsButton
                  text={
                    cloze
                      ? clozeToSpoken(getClozeText(note), "question")
                      : isDisciplinary
                        ? disciplinaryFront
                        : (basic?.front ?? "")
                  }
                />
              </div>
              <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-10">
                {cloze ? (
                  <div
                    className="w-full whitespace-pre-wrap text-center text-xl leading-relaxed"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: the cloze renderer escapes user input and only emits a fixed set of spans.
                    dangerouslySetInnerHTML={{ __html: cloze.questionHtml }}
                  />
                ) : (
                  <div className="w-full whitespace-pre-wrap text-center text-2xl font-medium leading-relaxed">
                    {(isDisciplinary ? disciplinaryFront : basic?.front) || (
                      <span className="text-muted-foreground italic">(verso vide)</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Back (answer) face — same size; reverse-rotated so its text reads correctly when the parent has rotated to 180. */}
            <Card
              className={cn("absolute inset-0 min-h-[280px] w-full", "border-primary/40 shadow-md")}
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
              aria-hidden={isAnswer ? undefined : true}
            >
              <div className="absolute right-3 top-3 z-10">
                <TtsButton
                  text={
                    cloze
                      ? clozeToSpoken(getClozeText(note), "answer")
                      : isDisciplinary
                        ? disciplinaryBackSpoken
                        : (basic?.back ?? "")
                  }
                />
              </div>
              <CardContent className="flex min-h-[280px] flex-col items-stretch gap-4 p-10">
                {cloze ? (
                  <div
                    className="w-full whitespace-pre-wrap text-center text-xl leading-relaxed"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: same as above — escaped + curated tags only.
                    dangerouslySetInnerHTML={{ __html: cloze.answerHtml }}
                  />
                ) : isIllness ? (
                  <>
                    <div className="text-center text-sm font-medium text-muted-foreground">
                      {strField(note, "condition")}
                    </div>
                    <hr className="border-border" />
                    <dl className="space-y-3 text-left">
                      {illnessSections.map((section) => (
                        <div key={section.label}>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-primary">
                            {section.label}
                          </dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-base leading-relaxed">
                            {section.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : isRefutation ? (
                  <>
                    <div className="whitespace-pre-wrap text-center text-base text-muted-foreground">
                      {strField(note, "misconception")}
                    </div>
                    <hr className="border-border" />
                    <div className="whitespace-pre-wrap text-center text-2xl font-medium leading-relaxed">
                      <span className="font-bold text-destructive">FAUX.</span>{" "}
                      {refutationCorrect || (
                        <span className="text-muted-foreground italic">(verso vide)</span>
                      )}
                    </div>
                    {refutationExplanation && (
                      <p className="whitespace-pre-wrap text-center text-sm italic text-muted-foreground">
                        {refutationExplanation}
                      </p>
                    )}
                  </>
                ) : isWorkedExample && workedExample ? (
                  <WorkedExampleBack
                    key={`we-${note.id}`}
                    problem={workedExample.problem}
                    steps={workedExample.steps}
                    answer={workedExample.answer}
                  />
                ) : (
                  <>
                    <div className="whitespace-pre-wrap text-center text-lg text-muted-foreground">
                      {basic?.front}
                    </div>
                    <hr className="border-border" />
                    <div className="whitespace-pre-wrap text-center text-2xl font-medium leading-relaxed">
                      {basic?.back || (
                        <span className="text-muted-foreground italic">(verso vide)</span>
                      )}
                    </div>
                    {basic?.hint && (
                      <p className="text-center text-sm italic text-muted-foreground">
                        {basic.hint}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {showVoiceAnswer && basic ? (
          <div className="flex w-full justify-center">
            <VoiceAnswerButton
              key={`voice-${note.id}`}
              language="fr"
              onTranscribed={(text) => {
                const score = similarityScore(text, basic.back);
                onTypedAnswer?.(text, score, verdictFor(score));
              }}
            />
          </div>
        ) : null}

        {showTypeAnswer && basic ? (
          <div className="flex w-full justify-center">
            <TypeAnswer
              key={note.id}
              expectedAnswer={basic.back}
              onSubmit={(typed, score, verdict) => onTypedAnswer?.(typed, score, verdict)}
            />
          </div>
        ) : null}

        {showElaboration && <ElaborationStrip elaboration={elaboration} />}
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Internal — small presentational helpers (Vague 5)
// ---------------------------------------------------------------------------

function DeckBadge({ deckName }: { deckName: string }) {
  return (
    <span className="rounded-full border border-primary/30 bg-primary/5 px-3 py-0.5 text-xs font-medium text-primary">
      {deckName}
    </span>
  );
}

/**
 * Vague 15 — verso of a faded worked example. The problem is restated, then
 * the solution steps reveal one at a time as the learner clicks « Étape
 * suivante » (predicting each before unveiling it — the faded scaffolding of
 * Sweller/Renkl/Atkinson 2003). « Tout afficher » jumps to the full solution
 * including the final answer; the answer only shows once every step is out.
 *
 * Reveal state is local and reset whenever the note changes (the `key` on the
 * call-site forces a remount, and the effect guards against stale counts when
 * React reuses the instance).
 */
function WorkedExampleBack({
  problem,
  steps,
  answer,
}: {
  problem: string;
  steps: string[];
  answer: string;
}) {
  const [revealed, setRevealed] = useState(0);

  // Reset the reveal counter if the underlying steps change identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on content change only
  useEffect(() => {
    setRevealed(0);
  }, [problem, answer, steps.length]);

  const allRevealed = revealed >= steps.length;

  return (
    <div className="flex w-full flex-col gap-4" data-testid="worked-example-back">
      <div className="whitespace-pre-wrap text-center text-base text-muted-foreground">
        {problem}
      </div>
      <hr className="border-border" />
      <ol className="space-y-2 text-left">
        {steps.slice(0, revealed).map((step, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and reorder-free
            key={`step-${i}`}
            className="flex gap-2 whitespace-pre-wrap text-base leading-relaxed"
          >
            <span className="shrink-0 font-semibold tabular-nums text-primary">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {!allRevealed ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="worked-example-next-step"
            onClick={() => setRevealed((n) => Math.min(n + 1, steps.length))}
          >
            Étape suivante ({revealed}/{steps.length})
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(steps.length)}>
            Tout afficher
          </Button>
        </div>
      ) : (
        <div
          className="whitespace-pre-wrap text-center text-2xl font-medium leading-relaxed"
          data-testid="worked-example-answer"
        >
          <span className="text-base font-semibold text-primary">Réponse :</span>{" "}
          {answer || <span className="text-muted-foreground italic">(réponse vide)</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Render the « Pourquoi / Exemple » strip below the answer face. Uses
 * native `<details>` so we don't need an extra Disclosure dependency; both
 * sections start open because the elaboration is the whole point of
 * enabling the enrichment, but the learner can collapse them if a section
 * is distracting.
 */
function ElaborationStrip({ elaboration }: { elaboration: ElaborationFields }) {
  return (
    <div className="grid w-full max-w-2xl gap-2 text-sm">
      {elaboration.why.length > 0 && (
        <details
          open
          className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
          data-testid="elaboration-why"
        >
          <summary className="cursor-pointer select-none font-medium text-primary">
            Pourquoi
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap text-foreground/90">{elaboration.why}</p>
        </details>
      )}
      {elaboration.example.length > 0 && (
        <details
          open
          className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
          data-testid="elaboration-example"
        >
          <summary className="cursor-pointer select-none font-medium text-primary">Exemple</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-foreground/90">{elaboration.example}</p>
        </details>
      )}
    </div>
  );
}
