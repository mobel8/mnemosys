/**
 * First-run wizard — three slides + a branching final CTA.
 *
 * Triggered by the index route when both conditions are true:
 *   1. `useDecks()` returns an empty array (clean install)
 *   2. localStorage key `mnemosys.first_run_completed` is unset
 *
 * On the final slide the user picks between loading the demo decks
 * (calls `api.demo.load()` via `useLoadDemo`) or creating their own
 * deck (just closes the wizard — the home page already shows an
 * empty state with a "New deck" button).
 *
 * Slide transitions use Framer Motion's `AnimatePresence` so each
 * slide cleanly enters from the right and exits left as the user
 * advances, mirroring native onboarding flows.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Brain, ChevronLeft, ChevronRight, Plus, Sparkles, Wand2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useLoadDemo } from "@/lib/queries";

export const FIRST_RUN_KEY = "mnemosys.first_run_completed";

interface FirstRunWizardProps {
  open: boolean;
  onClose: () => void;
}

interface Slide {
  key: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  body: ReactNode;
}

const SLIDES: Slide[] = [
  {
    key: "welcome",
    icon: <Sparkles className="h-8 w-8" />,
    title: "Bienvenue dans Mnemosys",
    subtitle: "La mémorisation efficace, sans friction.",
    body: (
      <p className="text-sm text-muted-foreground">
        Crée des cartes, révise-les au bon moment, et regarde ta rétention grimper. On t'explique
        comment en 30 secondes.
      </p>
    ),
  },
  {
    key: "fsrs",
    icon: <Brain className="h-8 w-8" />,
    title: "FSRS-6 : l'algorithme qui décide quand réviser",
    subtitle: "Pour chaque carte, le bon intervalle au bon moment.",
    body: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          Mnemosys utilise <strong>FSRS-6</strong>, l'algorithme open-source adopté par Anki en
          2024. Il modélise ta mémoire (stabilité + difficulté) à partir de chaque review et
          planifie la prochaine au moment optimal.
        </p>
        <p>
          Concrètement : <strong>20 à 30 % de reviews en moins</strong> qu'avec SuperMemo-2, pour la
          même rétention.
        </p>
      </div>
    ),
  },
  {
    key: "start",
    icon: <Wand2 className="h-8 w-8" />,
    title: "Comment veux-tu démarrer ?",
    subtitle: "4 decks démo prêts à l'emploi, ou ton propre deck en 10 secondes.",
    body: (
      <p className="text-sm text-muted-foreground">
        Les decks démo couvrent du vocabulaire EN→FR, les capitales du monde, JavaScript/TypeScript
        et la biologie cellulaire (835 cartes au total). Tu peux les modifier, les supprimer, ou
        partir de zéro.
      </p>
    ),
  },
];

export function FirstRunWizard({ open, onClose }: FirstRunWizardProps) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);

  const loadDemo = useLoadDemo({
    onSuccess: (count) => {
      toast({
        title: "Decks démo chargés",
        description: `${count} deck${count > 1 ? "s" : ""} ajouté${count > 1 ? "s" : ""}.`,
      });
      finish();
    },
    onError: (err) => {
      toast({
        title: "Chargement impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function finish() {
    try {
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      // Storage disabled (private mode) — wizard will reappear next launch.
    }
    setIndex(0);
    setDirection(1);
    onClose();
  }

  function next() {
    if (index < SLIDES.length - 1) {
      setDirection(1);
      setIndex(index + 1);
    }
  }

  function prev() {
    if (index > 0) {
      setDirection(-1);
      setIndex(index - 1);
    }
  }

  if (!open) return null;

  // `index` is clamped in `next/prev`, but `noUncheckedIndexedAccess` makes
  // TS treat the lookup as possibly undefined. We bail to `null` instead of
  // the first slide so a corrupted index can't silently lock the wizard on
  // the welcome screen forever.
  const slide = SLIDES[index];
  if (!slide) return null;
  const isLast = index === SLIDES.length - 1;
  // Direction-aware offsets for the slide transition. Positive direction
  // means "we just clicked Next" (incoming from the right, outgoing to the
  // left); negative is the mirror.
  const enterOffset = direction * 32;
  const exitOffset = direction * -32;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur"
    >
      <div className="relative mx-4 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {/* Progress bar — animate via scaleX (GPU/transform) rather than
            `width` so the bar never triggers a layout reflow on each step. */}
        <div className="h-1 w-full bg-muted">
          <motion.div
            className="h-full w-full origin-left bg-primary"
            initial={false}
            animate={{ scaleX: (index + 1) / SLIDES.length }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>

        <div className="relative min-h-[340px] px-8 pt-10 pb-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={slide.key}
              initial={{ opacity: 0, x: enterOffset }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: exitOffset }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-5"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {slide.icon}
              </div>
              <div className="space-y-1.5">
                <h2 id="wizard-title" className="text-2xl font-semibold tracking-tight">
                  {slide.title}
                </h2>
                <p className="text-base text-muted-foreground">{slide.subtitle}</p>
              </div>
              <div>{slide.body}</div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-card/50 px-8 py-4">
          <div className="flex items-center gap-1.5">
            {SLIDES.map((s, i) => (
              <span
                key={s.key}
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === index ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {index > 0 && !isLast && (
              <Button variant="ghost" size="sm" onClick={prev}>
                <ChevronLeft className="h-4 w-4" />
                Précédent
              </Button>
            )}
            {!isLast ? (
              <>
                <Button variant="ghost" size="sm" onClick={finish}>
                  Passer
                </Button>
                <Button size="sm" onClick={next}>
                  Suivant
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={finish} disabled={loadDemo.isPending}>
                  <Plus className="h-4 w-4" />
                  Créer mon propre deck
                </Button>
                <Button size="sm" onClick={() => loadDemo.mutate()} disabled={loadDemo.isPending}>
                  <Sparkles className="h-4 w-4" />
                  {loadDemo.isPending ? "Chargement…" : "Charger les decks démo"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** True when the user hasn't completed the wizard yet (or storage isn't available). */
export function isFirstRunPending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== "1";
  } catch {
    return false;
  }
}

/** Imperative reset used by Settings → "Replay first-run". */
export function clearFirstRunFlag() {
  try {
    localStorage.removeItem(FIRST_RUN_KEY);
  } catch {
    // ignore
  }
}
