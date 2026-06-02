/**
 * Settings → "Apparence". Lets the user pick light / dark / system theme.
 * Backed by `useTheme()` which persists the choice via `api.settings.save`.
 */

import { Monitor, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Theme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface ThemeOption {
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: ThemeOption[] = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Système", icon: Monitor },
];

export function ThemeSection() {
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apparence</CardTitle>
        <CardDescription>Choisis le thème de l'interface.</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset>
          <legend className="sr-only">Thème</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = theme === opt.value;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
                    selected
                      ? "border-primary bg-accent text-accent-foreground shadow-sm"
                      : "border-input text-muted-foreground hover:border-primary/40 hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={opt.value}
                    checked={selected}
                    onChange={() => {
                      void setTheme(opt.value);
                    }}
                    className="sr-only"
                  />
                  <Icon className={cn("h-5 w-5", selected && "text-brand-500")} />
                  <span className="text-sm font-medium">{opt.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
