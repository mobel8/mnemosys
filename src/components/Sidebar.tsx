/**
 * Persistent left navigation. Houses the logo, grouped top-level navigation,
 * theme toggle, and a small footer with the version + GitHub link.
 *
 * Nav items are grouped into labelled sections so the 14 destinations read as
 * an organised tool, not a flat dump. Active-route highlighting uses the
 * current pathname; extending the menu is just appending to a group's `items`.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import {
  AudioLines,
  BarChart3,
  Binary,
  BookOpen,
  CalendarClock,
  Compass,
  Ear,
  Github,
  Home,
  Languages,
  Moon,
  Music2,
  Network,
  Palette,
  ScanText,
  Settings,
  Shuffle,
  Sparkles,
  Sun,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  heading?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ to: "/", label: "Accueil", icon: Home }],
  },
  {
    heading: "Apprendre",
    items: [
      { to: "/review-interleaved", label: "Révision entrelacée", icon: Shuffle },
      { to: "/ai-generate", label: "Génération IA", icon: Sparkles },
      { to: "/capture", label: "Capture → cartes", icon: ScanText },
      { to: "/reading", label: "Lecture", icon: BookOpen },
      { to: "/shadowing", label: "Shadowing", icon: AudioLines },
      { to: "/vocabulary", label: "Vocabulaire", icon: Languages },
      { to: "/pronunciation", label: "Prononciation", icon: Ear },
    ],
  },
  {
    heading: "Mémoire & pratique",
    items: [
      { to: "/palaces", label: "Palais de mémoire", icon: Compass },
      { to: "/mnemonics", label: "Mnémotechnique", icon: Binary },
      { to: "/music", label: "Musique", icon: Music2 },
      { to: "/gesture", label: "Dessin", icon: Palette },
    ],
  },
  {
    heading: "Progression",
    items: [
      { to: "/stats", label: "Statistiques", icon: BarChart3 },
      { to: "/graph", label: "Graphe", icon: Network },
      { to: "/achievements", label: "Succès", icon: Trophy },
      { to: "/planner", label: "Planning", icon: CalendarClock },
    ],
  },
];

const APP_VERSION = import.meta.env.PACKAGE_VERSION ?? "0.8.0";

export function Sidebar() {
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-card/50">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-primary-foreground shadow-sm">
          M
        </div>
        <span className="font-display text-[0.95rem] font-semibold tracking-tight">Mnemosys</span>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.heading ?? `group-${gi}`} className="space-y-1">
            {group.heading && (
              <p className="px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.heading}
              </p>
            )}
            {group.items.map((item) => {
              const active =
                item.to === "/" ? currentPath === "/" : currentPath.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active ? "text-accent-foreground" : "text-muted-foreground/80",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t p-3">
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
            currentPath.startsWith("/settings")
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Paramètres
        </Link>

        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            void setTheme(resolvedTheme === "dark" ? "light" : "dark");
          }}
        >
          {resolvedTheme === "dark" ? (
            <>
              <Sun className="h-4 w-4" /> Mode clair
            </>
          ) : (
            <>
              <Moon className="h-4 w-4" /> Mode sombre
            </>
          )}
        </Button>

        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">v{APP_VERSION}</span>
          <a
            href="https://github.com/mobel8/mnemosys"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </aside>
  );
}
