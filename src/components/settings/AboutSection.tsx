/**
 * Settings → "À propos". Static panel that surfaces the app version,
 * credits and tech stack. Version is sourced from `import.meta.env` (Vite
 * injects the package.json version at build time — see `vite.config.ts`).
 */

import { Github, RefreshCw } from "lucide-react";
import { clearFirstRunFlag } from "@/components/FirstRunWizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";

// `PACKAGE_VERSION` is injected by vite.config.ts (a `define` entry pointing
// at package.json#version). Vitest doesn't run vite, so the define is absent
// under jsdom — we fall back to a sentinel so the panel still renders.
const VERSION = import.meta.env.PACKAGE_VERSION ?? "0.1.0";

const GITHUB_URL = "https://github.com/mnemosys/mnemosys";

export function AboutSection() {
  function replayWizard() {
    clearFirstRunFlag();
    toast({
      title: "Wizard réinitialisé",
      description: "Recharge l'accueil pour revoir le tour de bienvenue.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>À propos</CardTitle>
        <CardDescription>Crédits, version et stack technique.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            M
          </div>
          <div>
            <p className="text-lg font-semibold">Mnemosys</p>
            <p className="text-xs text-muted-foreground">
              Version <span className="tabular-nums">{VERSION}</span>
            </p>
          </div>
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Algorithme <strong className="text-foreground">FSRS-6</strong> par{" "}
            <a
              href="https://github.com/open-spaced-repetition"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              open-spaced-repetition
            </a>
            .
          </p>
          <p>
            Stack :{" "}
            <span className="text-foreground">Tauri 2 · React 19 · FSRS-6 · Rust · SQLite</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={replayWizard}>
            <RefreshCw className="h-4 w-4" />
            Rejouer le wizard d'accueil
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
