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
  piper_enabled: false,
  piper_binary_path: "",
  piper_model_path: "",
  anthropic_api_key: null,
  supabase_url: null,
  supabase_anon_key: null,
  // Vague 2 cognitive features — opt-in.
  type_the_answer_enabled: false,
  confidence_rating_enabled: false,
  pre_questioning_enabled: false,
  // Vague 3 neuro modes — all opt-in, master switch off.
  neuro_modes_enabled: false,
  mood_checkin_enabled: false,
  movement_break_minutes: 25,
  cyclic_sighing_enabled: false,
  sketch_before_flip_enabled: false,
  delayed_jol_enabled: false,
  jol_delay_minutes: 30,
  voice_answer_enabled: false,
  // Vague 12 cognitive features — all opt-in.
  pretest_mode_enabled: false,
  self_explanation_enabled: false,
  focus_guard_enabled: false,
  // Vague 18 — local AI + advanced neuro.
  ollama_enabled: false,
  ollama_url: null,
  ollama_model: null,
  chronotype: null,
  ambient_sound: "none",
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
