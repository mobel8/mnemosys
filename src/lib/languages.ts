/**
 * Vague 10 — shared constants for the language-learning mode.
 *
 * Two small lookup tables used by the deck dialogs (language picker) and the
 * note editor / frequency-coverage card (Zipf bands). Kept here so the UI and
 * the unit tests agree on the exact label/value pairs.
 */

import type { FrequencyBand } from "@/lib/tauri";

/** One selectable deck language. `code` is the ISO 639-1 value persisted on
 *  the deck (`null` = no language). `label` is the human-readable name. */
export interface LanguageOption {
  code: string | null;
  label: string;
}

/** Picker options for a deck's `language_mode`. The first entry clears it. */
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: null, label: "Aucune" },
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
] as const;

/** Resolve a stored ISO code to its display label (falls back to the code). */
export function languageLabel(code: string | null | undefined): string {
  if (!code) return "Aucune";
  return LANGUAGE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

/** One selectable Zipf frequency band. `value === null` means "no band". */
export interface FrequencyBandOption {
  value: FrequencyBand | null;
  label: string;
}

/** Picker options for a note's `frequency_band`. The first entry clears it. */
export const FREQUENCY_BAND_OPTIONS: readonly FrequencyBandOption[] = [
  { value: null, label: "Aucune" },
  { value: "top_100", label: "Top 100" },
  { value: "top_1k", label: "Top 1k" },
  { value: "top_5k", label: "Top 5k" },
  { value: "top_10k", label: "Top 10k" },
  { value: "beyond", label: "Au-delà" },
] as const;

/** Ordered bands (most → least frequent) used to render the coverage bar. */
export const FREQUENCY_BAND_ORDER: readonly {
  key: FrequencyBand | "untagged";
  label: string;
  /** Tailwind background class for this band's bar segment + legend swatch. */
  color: string;
}[] = [
  { key: "top_100", label: "Top 100", color: "bg-emerald-500" },
  { key: "top_1k", label: "Top 1k", color: "bg-green-500" },
  { key: "top_5k", label: "Top 5k", color: "bg-lime-500" },
  { key: "top_10k", label: "Top 10k", color: "bg-amber-500" },
  { key: "beyond", label: "Au-delà", color: "bg-orange-500" },
  { key: "untagged", label: "Non taggé", color: "bg-muted-foreground/40" },
] as const;
