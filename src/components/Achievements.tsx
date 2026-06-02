/**
 * Achievements grid — visual reward catalog.
 *
 * White Hat principle: every badge is positive feedback. Locked badges show
 * up greyed-out so the learner sees what's reachable, but **no progress bar
 * presses them** to grind. Tooltips include the recipe ("Garde 7 jours de
 * streak") so the path is transparent.
 */

import { motion } from "framer-motion";
import { Award, Crown, Flame, Sparkles, Trophy } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAchievements } from "@/lib/queries";
import { cn } from "@/lib/utils";

type IconCmp = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

interface CatalogEntry {
  label: string;
  description: string;
  icon: IconCmp;
  /**
   * Design-system text color token for the badge in its unlocked state.
   * Drawn from the chart palette + semantic tokens so badges stay on-theme
   * in light and dark (no raw Tailwind palette / zero-chroma greys).
   */
  tone: string;
}

/**
 * Static catalog of every achievement code the backend may emit. Keep in
 * sync with `commands/review.rs::update_gamification`. New codes added on
 * the Rust side should land here too; unknown codes fall back to a generic
 * Trophy.
 */
export const ACHIEVEMENTS_CATALOG: Record<string, CatalogEntry> = {
  first_review: {
    label: "Première carte",
    description: "Tu as répondu à ta première carte. Bienvenue !",
    icon: Sparkles,
    tone: "text-chart-2",
  },
  first_deck: {
    label: "Premier deck",
    description: "Tu as créé ton premier deck. L'aventure commence.",
    icon: Sparkles,
    tone: "text-brand-500",
  },
  streak_3: {
    label: "3 jours",
    description: "Trois jours d'affilée. L'habitude s'installe.",
    icon: Flame,
    tone: "text-warning",
  },
  streak_7: {
    label: "Une semaine",
    description: "Sept jours consécutifs. C'est solide.",
    icon: Flame,
    tone: "text-warning",
  },
  streak_30: {
    label: "Un mois",
    description: "Trente jours d'affilée. Bravo pour la régularité.",
    icon: Flame,
    tone: "text-chart-5",
  },
  streak_100: {
    label: "Cent jours",
    description: "100 jours sans interruption. Tu es inarrêtable.",
    icon: Crown,
    tone: "text-warning",
  },
  reviews_100: {
    label: "100 reviews",
    description: "Tu as franchi le cap des 100 cartes étudiées.",
    icon: Award,
    tone: "text-success",
  },
  reviews_1000: {
    label: "1 000 reviews",
    description: "Mille cartes — voilà un cerveau bien entrainé.",
    icon: Award,
    tone: "text-chart-2",
  },
  reviews_10000: {
    label: "10 000 reviews",
    description: "Dix mille reviews. Tu joues dans la cour des maîtres.",
    icon: Trophy,
    tone: "text-warning",
  },
  master_100: {
    label: "100 cartes maîtrisées",
    description: "Cent cartes avec une stabilité ≥ 90 jours.",
    icon: Crown,
    tone: "text-chart-5",
  },
};

/** Display order: onboarding → streaks → volume → mastery. */
const DISPLAY_ORDER: string[] = [
  "first_review",
  "first_deck",
  "streak_3",
  "streak_7",
  "streak_30",
  "streak_100",
  "reviews_100",
  "reviews_1000",
  "reviews_10000",
  "master_100",
];

function formatUnlockedAt(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function Achievements() {
  const achievements = useAchievements();

  // Map for O(1) lookups of unlocked timestamps.
  const unlockedAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of achievements.data ?? []) {
      m.set(a.code, a.unlocked_at);
    }
    return m;
  }, [achievements.data]);

  if (achievements.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="achievements-loading">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, order is stable
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {DISPLAY_ORDER.map((code, i) => {
        const entry = ACHIEVEMENTS_CATALOG[code];
        if (!entry) return null;
        const ts = unlockedAt.get(code);
        const Icon = entry.icon;
        const locked = ts === undefined;
        return (
          <motion.div
            key={code}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.2,
              delay: Math.min(i * 0.03, 0.24),
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Card
              className={cn(
                "h-full transition-[opacity,box-shadow] duration-200 hover:shadow-md",
                locked && "opacity-50 grayscale",
              )}
              data-locked={locked ? "true" : "false"}
              data-testid={`achievement-${code}`}
            >
              <CardContent className="flex items-start gap-3 p-4">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    locked ? "bg-muted text-muted-foreground" : cn("bg-brand-50", entry.tone),
                  )}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-display font-semibold leading-tight tracking-tight">
                      {entry.label}
                    </h3>
                    {locked ? (
                      <Badge variant="outline" className="text-[10px]">
                        Verrouillé
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                        {formatUnlockedAt(ts)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
