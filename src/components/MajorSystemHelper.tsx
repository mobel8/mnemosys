/**
 * Major System helper (Vague 21 — mnémotechnique des chiffres).
 *
 * The Major System (a.k.a. phonetic number system, used by memory athletes)
 * maps each digit 0-9 to one or more consonant *sounds*. You turn a number
 * into a word by stringing the consonants together and freely inserting
 * vowels (a/e/i/o/u) and the "silent" letters h/w/y. The resulting word is
 * far more memorable than the raw digits, and pairs naturally with PAO
 * (Person-Action-Object): each 2-digit group becomes a Person, an Action or
 * an Object you can vividly picture.
 *
 * This component is pure frontend (no backend): it shows the digit→consonant
 * mapping for a typed number plus a pre-filled table of example French words
 * for 0-9 and 00-99. The mapping functions are exported for unit testing.
 */

import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Canonical digit → consonant-sound mapping. Each entry lists the phonemes
 * (not letters) a digit stands for. This is the standard mnemonic-major table
 * shared by the memory-sport community.
 */
export const MAJOR_DIGITS: { digit: number; consonants: string; mnemonic: string }[] = [
  { digit: 0, consonants: "s, z", mnemonic: "« z » = Zéro" },
  { digit: 1, consonants: "t, d", mnemonic: "« t » a 1 barre verticale" },
  { digit: 2, consonants: "n", mnemonic: "« n » a 2 jambages" },
  { digit: 3, consonants: "m", mnemonic: "« m » a 3 jambages" },
  { digit: 4, consonants: "r", mnemonic: "« quatre » finit par R" },
  { digit: 5, consonants: "l", mnemonic: "L = 50 en chiffres romains" },
  { digit: 6, consonants: "ch, j, g doux", mnemonic: "« j » miroir du 6" },
  { digit: 7, consonants: "k, c dur, g dur", mnemonic: "deux 7 forment un K" },
  { digit: 8, consonants: "f, v", mnemonic: "« f » cursif a 2 boucles comme 8" },
  { digit: 9, consonants: "p, b", mnemonic: "« p » miroir du 9" },
];

/**
 * Example French word for each single digit (0-9). Picked so the *first*
 * consonant sound matches the digit and there are no other coding consonants.
 */
const SINGLE_DIGIT_WORDS: Record<number, string> = {
  0: "eau (z… « zoo »)",
  1: "thé",
  2: "nœud",
  3: "main",
  4: "roue",
  5: "loup",
  6: "joue",
  7: "képi",
  8: "feu",
  9: "pou",
};

/**
 * A curated set of 2-digit peg words (FR) illustrating the system. Not the
 * full 0-99 (which every learner personalises) — a representative sample so
 * the method clicks. Each word's coding consonants spell the number.
 */
const PAIR_WORDS: Record<number, string> = {
  10: "toise",
  12: "tonne",
  21: "note",
  25: "Nil",
  31: "mat",
  42: "renne",
  51: "lit",
  64: "char",
  73: "came",
  85: "fil",
  90: "base",
  99: "bébé",
};

/** Single-character labels for the per-digit chips in the breakdown. */
function consonantsFor(digit: number): string {
  return MAJOR_DIGITS.find((d) => d.digit === digit)?.consonants ?? "?";
}

/**
 * Break a number string into `[digit, consonants]` pairs, ignoring any
 * non-digit characters the user typed (spaces, separators). Exported for
 * unit testing.
 */
export function mapNumber(input: string): { digit: number; consonants: string }[] {
  return input
    .split("")
    .filter((ch) => ch >= "0" && ch <= "9")
    .map((ch) => {
      const digit = Number(ch);
      return { digit, consonants: consonantsFor(digit) };
    });
}

/**
 * Look up a curated example peg word for a number, if one exists in the table.
 * Tries the full number first (e.g. "31" → "mat"), else single digits.
 * Exported for unit testing.
 */
export function suggestWord(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  const asNum = Number(digits);
  if (digits.length <= 2 && PAIR_WORDS[asNum]) return PAIR_WORDS[asNum];
  if (digits.length === 1 && SINGLE_DIGIT_WORDS[asNum]) return SINGLE_DIGIT_WORDS[asNum];
  return null;
}

export function MajorSystemHelper() {
  const [value, setValue] = useState("314");
  const breakdown = mapNumber(value);
  const suggestion = suggestWord(value);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Convertir un nombre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="major-input">Nombre à mémoriser</Label>
            <Input
              id="major-input"
              inputMode="numeric"
              placeholder="314"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          {breakdown.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2" data-testid="major-breakdown">
                {breakdown.map((b, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: derived positional list (digit sequence); position IS the identity
                    key={`${b.digit}-${i}`}
                    className="flex flex-col items-center rounded-lg border bg-muted/40 px-3 py-1.5"
                  >
                    <span className="font-display text-lg font-semibold tabular-nums">
                      {b.digit}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{b.consonants}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                Consonnes :{" "}
                <span className="font-mono font-medium">
                  {breakdown.map((b) => b.consonants).join(" · ")}
                </span>
              </p>
              {suggestion && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm">
                  <Lightbulb className="h-4 w-4 shrink-0 text-warning" />
                  Mot-exemple : <span className="font-medium">{suggestion}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-6 py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
                <Lightbulb className="h-5 w-5" />
              </div>
              <p className="text-sm text-muted-foreground">
                Saisis des chiffres pour voir leur décomposition en sons consonnes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">La table des chiffres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-2">
            {MAJOR_DIGITS.map((d) => (
              <div key={d.digit} className="flex items-baseline gap-2 text-sm">
                <span className="w-5 font-display font-semibold tabular-nums text-brand-500">
                  {d.digit}
                </span>
                <span className="font-mono">{d.consonants}</span>
                <span className="truncate text-xs text-muted-foreground">{d.mnemonic}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Composer des mots</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            On ajoute librement des voyelles (a, e, i, o, u) et les lettres muettes (h, w, y) entre
            les consonnes. Seuls les <strong>sons consonnes</strong> comptent : « roue » code 4, «
            note » code 21.
          </p>
          <p>
            Chaque groupe de 2 chiffres peut devenir une image <strong>PAO</strong>
            (Personne-Action-Objet) : 31 → « mat » (un mât de bateau), que tu places dans un palais
            de mémoire. C'est ainsi que les athlètes de la mémoire retiennent des centaines de
            chiffres.
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {Object.entries(PAIR_WORDS).map(([num, word]) => (
              <div key={num} className="flex items-baseline gap-2">
                <span className="w-6 font-mono font-medium text-foreground">{num}</span>
                <span>{word}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
