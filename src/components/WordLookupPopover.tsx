/**
 * WordLookupPopover (Vague 17 — LingQ-style inline dictionary).
 *
 * Wraps a clickable trigger (typically a highlighted word inside an imported
 * reading text) and, when activated, opens a small token-styled popover that
 * shows the word, its IPA, its part of speech and a French gloss pulled from
 * the embedded `lookupLocal` dictionary.
 *
 * Why a hand-rolled popover (not Radix): `@radix-ui/react-popover` is NOT a
 * project dependency (see package.json) and the brief forbids adding one. This
 * component therefore implements a minimal, accessible floating panel:
 *   - portalled to <body> so it escapes `overflow:hidden` reading containers,
 *   - viewport-aware placement (flips above the anchor near the bottom edge,
 *     clamps horizontally to stay on-screen),
 *   - dismissal on Escape, outside-click and scroll/resize,
 *   - focus moved into the panel on open and restored to the trigger on close,
 *   - sober transform/opacity motion via framer-motion (ease tokens), with
 *     `prefers-reduced-motion` honoured globally by the app.
 *
 * The component is presentation-only: the actual AI lookup and card creation
 * are delegated to the host via `onAiLookup` / `onCreateCard` callbacks so the
 * orchestrator owns the mutations (e.g. `useGenerateCardsFromText`,
 * `useCreateNote`, `useCreateCardsFromWords`).
 */

import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Loader2, Plus, Sparkles, Volume2 } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { type DictEntry, lookupLocal } from "@/lib/dictionary";
import { cn } from "@/lib/utils";

/** Width of the floating panel, in px — kept as a constant for placement math. */
const PANEL_WIDTH = 264;
/** Gap between the anchor and the panel, in px. */
const PANEL_OFFSET = 8;
/** Minimum margin from the viewport edge, in px. */
const VIEWPORT_MARGIN = 8;
/** ease-out token from globals.css (`--ease-out`). */
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Resolved on-screen coordinates + flip direction for the panel. */
interface PanelPosition {
  top: number;
  left: number;
  /** `true` when the panel sits above its anchor (near the viewport bottom). */
  placedAbove: boolean;
}

export interface WordLookupPopoverProps {
  /**
   * The word to look up. Casing is preserved for display but the embedded
   * lookup is case-insensitive.
   */
  word: string;
  /**
   * The clickable trigger. Rendered inside a `<span>` wrapper that captures the
   * click; the host typically passes the highlighted word button/text here.
   */
  children: React.ReactNode;
  /**
   * Optional override for the dictionary entry. When omitted the component
   * resolves the entry itself via `lookupLocal(word)`. Pass this to inject an
   * AI-resolved definition after `onAiLookup` succeeds.
   */
  entry?: DictEntry | null;
  /**
   * Set while an AI lookup the host kicked off is in flight. Switches the
   * « définition non disponible » state to a loading skeleton.
   */
  aiLoading?: boolean;
  /**
   * Optional error message from a failed AI lookup. Rendered in the
   * unavailable state below the AI button.
   */
  aiError?: string | null;
  /**
   * Called when the user asks the AI to define a word missing from the offline
   * dictionary. The host runs the mutation and (optionally) feeds the result
   * back through the `entry` prop. Absence of this prop hides the AI button.
   */
  onAiLookup?: (word: string) => void;
  /**
   * Called when the user clicks « Créer une carte ». Receives the resolved
   * entry so the host can mint a note (front = word, back = gloss + IPA).
   * Absence of this prop hides the create-card button.
   */
  onCreateCard?: (entry: DictEntry) => void;
  /**
   * Called when the user clicks the « écouter » (speaker) button. The host
   * wires this to TTS (`useSynthesizeAudio`). Absence hides the button.
   */
  onSpeak?: (word: string) => void;
  /** Set while a TTS synthesis the host kicked off is in flight. */
  speakLoading?: boolean;
  /** Extra classes for the inline trigger wrapper. */
  className?: string;
  /** Controlled-open escape hatch; defaults to internal uncontrolled state. */
  open?: boolean;
  /** Notifies the host of open-state changes (works controlled or not). */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Compute the panel coordinates from the anchor rect + measured panel height,
 * flipping above the anchor when it would overflow the bottom edge and clamping
 * horizontally so the panel never leaves the viewport.
 */
function computePosition(anchor: DOMRect, panelHeight: number): PanelPosition {
  const spaceBelow = window.innerHeight - anchor.bottom;
  const placedAbove = spaceBelow < panelHeight + PANEL_OFFSET + VIEWPORT_MARGIN;

  const top = placedAbove ? anchor.top - panelHeight - PANEL_OFFSET : anchor.bottom + PANEL_OFFSET;

  // Centre on the anchor, then clamp into the viewport.
  const rawLeft = anchor.left + anchor.width / 2 - PANEL_WIDTH / 2;
  const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft));

  return { top: Math.max(VIEWPORT_MARGIN, top), left, placedAbove };
}

export function WordLookupPopover({
  word,
  children,
  entry: entryProp,
  aiLoading = false,
  aiError = null,
  onAiLookup,
  onCreateCard,
  onSpeak,
  speakLoading = false,
  className,
  open: openProp,
  onOpenChange,
}: WordLookupPopoverProps) {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? openProp : internalOpen;

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<PanelPosition | null>(null);

  // Resolve the dictionary entry: explicit prop wins, else embedded lookup.
  const entry = React.useMemo<DictEntry | null>(
    () => (entryProp !== undefined ? entryProp : lookupLocal(word)),
    [entryProp, word],
  );

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  // (Re)compute placement when the panel is open. Runs in a layout effect so
  // the panel never paints at (0,0) before being positioned.
  const reposition = React.useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) {
      return;
    }
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    setPosition(computePosition(anchor, panelHeight));
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    reposition();
    // Move focus into the panel for keyboard users.
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
      reposition();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, reposition]);

  // Dismiss on scroll/resize (the anchor would otherwise drift) + reposition.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const handleScroll = () => setOpen(false);
    const handleResize = () => reposition();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open, reposition, setOpen]);

  // Dismiss on Escape + outside click.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handlePointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("pointerdown", handlePointer, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("pointerdown", handlePointer, true);
    };
  }, [open, setOpen]);

  const toggle = React.useCallback(() => setOpen(!open), [open, setOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn("inline cursor-pointer rounded-sm text-left", className)}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label={`Définition de ${word}`}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.96, y: position?.placedAbove ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: position?.placedAbove ? 4 : -4 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
              style={{
                position: "fixed",
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                width: PANEL_WIDTH,
                visibility: position ? "visible" : "hidden",
              }}
              className={cn(
                "z-50 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none",
              )}
            >
              {entry ? (
                <DefinitionBody
                  entry={entry}
                  displayWord={word}
                  onSpeak={onSpeak}
                  speakLoading={speakLoading}
                  onCreateCard={
                    onCreateCard
                      ? () => {
                          onCreateCard(entry);
                          setOpen(false);
                        }
                      : undefined
                  }
                />
              ) : (
                <UnavailableBody
                  displayWord={word}
                  aiLoading={aiLoading}
                  aiError={aiError}
                  onAiLookup={onAiLookup ? () => onAiLookup(word) : undefined}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** Maps a part of speech to a short, lower-case French badge label. */
const POS_LABEL: Record<DictEntry["pos"], string> = {
  nom: "nom",
  verbe: "verbe",
  adjectif: "adjectif",
  adverbe: "adverbe",
  pronom: "pronom",
  préposition: "préposition",
  conjonction: "conjonction",
  déterminant: "déterminant",
  interjection: "interjection",
};

/** The populated definition card (state: word found in the dictionary). */
function DefinitionBody({
  entry,
  displayWord,
  onSpeak,
  speakLoading,
  onCreateCard,
}: {
  entry: DictEntry;
  displayWord: string;
  onSpeak?: (word: string) => void;
  speakLoading: boolean;
  onCreateCard?: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold tracking-tight">
            {displayWord}
          </h3>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-muted-foreground">{entry.ipa}</p>
        </div>
        {onSpeak ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1.5 -mt-1.5 size-8 shrink-0 text-muted-foreground"
            onClick={() => onSpeak(displayWord)}
            disabled={speakLoading}
            aria-label="Écouter la prononciation"
          >
            {speakLoading ? <Loader2 className="animate-spin" /> : <Volume2 />}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 px-4">
        <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          {POS_LABEL[entry.pos]}
        </span>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{entry.fr}</p>
      </div>

      {onCreateCard ? (
        <div className="mt-4 border-t bg-muted/40 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={onCreateCard}
          >
            <Plus />
            Créer une carte
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The fallback card (state: word absent from the offline dictionary). */
function UnavailableBody({
  displayWord,
  aiLoading,
  aiError,
  onAiLookup,
}: {
  displayWord: string;
  aiLoading: boolean;
  aiError: string | null;
  onAiLookup?: () => void;
}) {
  if (aiLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h3 className="font-display text-lg font-semibold tracking-tight">{displayWord}</h3>
        <div className="space-y-2" aria-hidden="true">
          <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded-full bg-muted" />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Génération de la définition…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-brand-100 text-brand-600">
        <BookOpen className="size-5" />
      </div>
      <div>
        <h3 className="font-display text-base font-semibold tracking-tight">{displayWord}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Définition non disponible hors-ligne.
        </p>
      </div>
      {aiError ? <p className="text-xs text-destructive">{aiError}</p> : null}
      {onAiLookup ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          className="w-full justify-center"
          onClick={onAiLookup}
        >
          <Sparkles />
          Générer avec l'IA
        </Button>
      ) : null}
    </div>
  );
}

export default WordLookupPopover;
