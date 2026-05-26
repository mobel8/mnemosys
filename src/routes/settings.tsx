import { createRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { type Theme, useTheme } from "@/lib/theme";
import { Route as rootRoute } from "./__root";

/**
 * Minimal settings page. Wave C will expand this with the full settings
 * surface (retention slider, daily limits, hotkey overrides, etc.).
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6 p-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Theme picker is wired today. The rest lands in Wave C.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Light, dark, or follow the operating system.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset className="space-y-2">
            <legend className="sr-only">Theme</legend>
            {THEMES.map((opt) => (
              <Label
                key={opt.value}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent"
              >
                <input
                  type="radio"
                  name="theme"
                  value={opt.value}
                  checked={theme === opt.value}
                  onChange={() => {
                    void setTheme(opt.value);
                  }}
                />
                <span>{opt.label}</span>
              </Label>
            ))}
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
