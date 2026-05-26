/**
 * Local mirror of the persisted [`AppSettings`] for component code that
 * needs synchronous access (e.g. "should the next-interval chip render?").
 *
 * The source of truth lives in the backend's `tauri-plugin-store`; we hydrate
 * this store on app boot via [`hydrateFromBackend`] and re-publish whenever
 * the settings page saves. Theme changes flow through `useTheme()` instead
 * since they need to mutate the DOM class — this store only tracks the
 * non-theme fields plus a `theme` snapshot for convenience.
 */

import { create } from "zustand";
import { type AppSettings, api } from "@/lib/tauri";

const DEFAULTS: AppSettings = {
  theme: "system",
  desired_retention: 0.9,
  daily_new_limit: 20,
  daily_review_limit: 200,
  show_next_interval: true,
  openai_api_key: null,
  tts_voice: null,
  tts_speed: null,
  anthropic_api_key: null,
  supabase_url: null,
  supabase_anon_key: null,
};

interface SettingsState extends AppSettings {
  hydrated: boolean;
  /** Pull the current values from the backend store. Safe to call repeatedly. */
  hydrateFromBackend: () => Promise<void>;
  /** Persist a partial update and refresh local state. */
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  async hydrateFromBackend() {
    try {
      const fresh = await api.settings.get();
      set({ ...fresh, hydrated: true });
    } catch {
      // Not inside Tauri — defaults are fine.
      set({ hydrated: true });
    }
  },
  async update(patch) {
    const { hydrated: _hydrated, hydrateFromBackend: _h, update: _u, ...current } = get();
    const next: AppSettings = { ...current, ...patch };
    await api.settings.save(next);
    set({ ...next });
  },
}));
