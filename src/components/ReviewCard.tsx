/**
 * Visual representation of the card currently being graded.
 *
 * Handles three templates:
 *   - "basic"          → `{ front, back }`
 *   - "basic_reverse"  → `{ front, back }` (rendered identically; the back
 *                        side is created server-side as a separate card row,
 *                        so from the UI's perspective there's no asymmetry).
 *   - "cloze"          → `{ text }` with `{{c1::answer}}` markers. The
 *                        first cloze deletion is hidden on the question
 *                        side and highlighted on the answer side.
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
import { Card, CardContent } from "@/components/ui/card";
import type { Note } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type Phase = "question" | "answer" | "submitting" | "done";

interface ReviewCardProps {
  note: Note;
  phase: Phase;
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
}

function getBasicFields(note: Note): BasicFields {
  const front = typeof note.fields.front === "string" ? note.fields.front : "";
  const back = typeof note.fields.back === "string" ? note.fields.back : "";
  return { front, back };
}

function getClozeText(note: Note): string {
  return typeof note.fields.text === "string" ? note.fields.text : "";
}

export function ReviewCard({ note, phase }: ReviewCardProps) {
  const isAnswer = phase === "answer" || phase === "submitting";
  const isCloze = note.template === "cloze";

  const cloze = isCloze ? renderCloze(getClozeText(note)) : null;
  const basic = !isCloze ? getBasicFields(note) : null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={note.id}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -40 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex w-full justify-center"
      >
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
            transition={{ duration: 0.35, ease: "easeInOut" }}
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
              <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-10">
                {cloze ? (
                  <div
                    className="w-full whitespace-pre-wrap text-center text-xl leading-relaxed"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: the cloze renderer escapes user input and only emits a fixed set of spans.
                    dangerouslySetInnerHTML={{ __html: cloze.questionHtml }}
                  />
                ) : (
                  <div className="w-full whitespace-pre-wrap text-center text-2xl font-medium leading-relaxed">
                    {basic?.front || (
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
              <CardContent className="flex min-h-[280px] flex-col items-stretch gap-4 p-10">
                {cloze ? (
                  <div
                    className="w-full whitespace-pre-wrap text-center text-xl leading-relaxed"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: same as above — escaped + curated tags only.
                    dangerouslySetInnerHTML={{ __html: cloze.answerHtml }}
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
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
