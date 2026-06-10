/**
 * Persistent left navigation. Houses the logo, the 6 top-level destinations,
 * theme toggle, and a small footer with the version + GitHub link.
 *
 * v0.11 — the menu went from 17 destinations in 4 groups down to 6 verbs that
 * match the app's real jobs: review, create, practice languages, measure,
 * configure. « Réviser » (the daily core action) finally has a first-class
 * entry — it starts a global session over every due card, interleaved across
 * decks. Everything that used to be a destination (palaces, metronome,
 * gesture timer, Major System, graph, achievements, planner) was either
 * removed or folded into Stats/Settings tabs.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Github,
  GraduationCap,
  Home,
  Languages,
  Moon,
  PlusCircle,
  Settings,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Accueil", icon: Home },
  { to: "/review-all", label: "Réviser", icon: GraduationCap },
  { to: "/create", label: "Créer", icon: PlusCircle },
  { to: "/language", label: "Langues", icon: Languages },
  { to: "/stats", label: "Statistiques", icon: BarChart3 },
];

// P130: dev fallback only — the real version is injected at build time from
// package.json (see vite.config). Never hard-code a stale release number here.
const APP_VERSION = import.meta.env.PACKAGE_VERSION ?? "0.0.0-dev";

export function Sidebar() {
  // P082: select only the pathname. The Sidebar is mounted permanently, so
  // subscribing to the whole RouterState would re-render it on every pending /
  // preload transition (defaultPreload='intent' fires on hover). The selector
  // narrows the subscription to the single value the nav highlighting needs.
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-card/50">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-primary-foreground shadow-sm">
          M
        </div>
        <span className="font-display text-[0.95rem] font-semibold tracking-tight">Mnemosys</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = item.to === "/" ? currentPath === "/" : currentPath.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t p-3">
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
          className="w-full justify-start gap-3"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {resolvedTheme === "dark" ? "Mode clair" : "Mode sombre"}
        </Button>
        <div className="flex items-center justify-between px-1">
          <span className="font-mono text-[0.6875rem] text-muted-foreground/70">
            v{APP_VERSION}
          </span>
          <a
            href="https://github.com/mobel8/mnemosys"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </aside>
  );
}
