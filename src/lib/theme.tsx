/**
 * Theme provider and `useTheme()` hook.
 *
 * - Reads the persisted theme from the backend's settings store on mount.
 * - Toggles the `dark` class on `<html>` so Tailwind's `dark:` variant
 *   (configured in `globals.css` via `@custom-variant dark`) picks it up.
 * - Listens to `prefers-color-scheme` changes so "system" tracks the OS.
 * - Persists changes through `api.settings.save()`.
 *
 * SSR-safe enough for a Tauri webview (which is always a browser context),
 * but defensive against missing `window` so the file can also be imported
 * from vitest's jsdom environment without exploding.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type AppSettings, api } from "@/lib/tauri";

export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  /** The actual variant currently applied (resolves "system" to OS value). */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeClass(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(getSystemTheme);

  // Hydrate from persisted settings on mount. If we're outside Tauri (e.g.
  // running in jsdom for unit tests) the invoke call rejects — fall back
  // silently to the default "system" theme.
  useEffect(() => {
    let cancelled = false;
    api.settings
      .get()
      .then((settings: AppSettings) => {
        if (!cancelled) setThemeState(settings.theme);
      })
      .catch(() => {
        /* not running inside Tauri — keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for OS theme changes so "system" stays in sync.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme;

  // Sync DOM class whenever the resolved theme changes.
  useEffect(() => {
    applyThemeClass(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(async (next: Theme) => {
    setThemeState(next);
    try {
      const current = await api.settings.get();
      await api.settings.save({ ...current, theme: next });
    } catch {
      /* outside Tauri — local-only update is fine */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
