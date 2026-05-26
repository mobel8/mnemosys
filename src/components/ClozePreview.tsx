/**
 * Live preview of the cards a cloze note will generate.
 *
 * Anki-style syntax: `{{c1::hidden text}}` (optionally `{{c1::text::hint}}`).
 * Each unique cloze index (c1, c2, ...) produces one card where its own
 * occurrences are masked with `[...]` while every other cloze is shown
 * in plain text. The same number may appear multiple times in the source
 * text — they all share a single card.
 */

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CLOZE_REGEX = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

interface ClozeMatch {
  num: number;
  text: string;
  hint?: string;
  start: number;
  end: number;
}

export function parseClozes(text: string): ClozeMatch[] {
  const matches: ClozeMatch[] = [];
  // Reset stateful regex between calls.
  CLOZE_REGEX.lastIndex = 0;
  let m = CLOZE_REGEX.exec(text);
  while (m !== null) {
    const numStr = m[1];
    const inner = m[2];
    const hint = m[3];
    if (numStr !== undefined && inner !== undefined) {
      matches.push({
        num: Number(numStr),
        text: inner,
        hint,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    m = CLOZE_REGEX.exec(text);
  }
  return matches;
}

export function uniqueClozeNumbers(text: string): number[] {
  const matches = parseClozes(text);
  return Array.from(new Set(matches.map((m) => m.num))).sort((a, b) => a - b);
}

/** Build the front-face string for cloze card `target`. */
export function renderClozeFront(text: string, target: number): string {
  const matches = parseClozes(text);
  if (matches.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.start);
    if (match.num === target) {
      result += match.hint ? `[${match.hint}]` : "[...]";
    } else {
      result += match.text;
    }
    cursor = match.end;
  }
  result += text.slice(cursor);
  return result;
}

/** Build the back-face string (all clozes revealed in-place). */
export function renderClozeBack(text: string): string {
  const matches = parseClozes(text);
  if (matches.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.start);
    result += match.text;
    cursor = match.end;
  }
  result += text.slice(cursor);
  return result;
}

interface ClozePreviewProps {
  text: string;
}

export function ClozePreview({ text }: ClozePreviewProps) {
  const numbers = useMemo(() => uniqueClozeNumbers(text), [text]);

  if (text.trim().length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Tape un texte avec <code className="rounded bg-muted px-1">{`{{c1::...}}`}</code> pour voir
        la preview des cartes.
      </div>
    );
  }

  if (numbers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-destructive/50 bg-destructive/5 p-6 text-center text-sm text-destructive">
        Aucune balise cloze détectée. Utilise <code>{`{{c1::texte}}`}</code> pour cacher du texte.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {numbers.length} {numbers.length === 1 ? "carte sera générée" : "cartes seront générées"}
      </p>
      {numbers.map((num) => (
        <Card key={num} className="border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Card c{num}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Front
              </p>
              <p className="mt-1 whitespace-pre-wrap">{renderClozeFront(text, num)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Back
              </p>
              <p className="mt-1 whitespace-pre-wrap">{renderClozeBack(text)}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
