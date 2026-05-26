/**
 * Persistent left navigation. Houses the logo, top-level navigation, theme
 * toggle, and a small footer with the version + GitHub link.
 *
 * Active-route highlighting uses TanStack Router's `Link.activeProps`, so
 * extending the menu is just appending to the `NAV_ITEMS` array.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Github, Home, Moon, Settings, Sparkles, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/ai-generate", label: "Génération IA", icon: Sparkles },
  { to: "/stats", label: "Stats", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r bg-card/40">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
          M
        </div>
        <span className="font-semibold tracking-tight">Mnemosys</span>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map((item) => {
          const active = item.to === "/" ? currentPath === "/" : currentPath.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t p-3">
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
              <Sun className="h-4 w-4" /> Light mode
            </>
          ) : (
            <>
              <Moon className="h-4 w-4" /> Dark mode
            </>
          )}
        </Button>

        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>v0.1.0</span>
          <a
            href="https://github.com/mnemosys"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </aside>
  );
}
