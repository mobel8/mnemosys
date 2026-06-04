/**
 * Single source of truth for the **default** [`AppSettings`] payload.
 *
 * The live settings are owned by `useSettingsQuery()` (TanStack Query, backed
 * by the backend's `tauri-plugin-store`) and theme changes flow through
 * `useTheme()`. This module exports only the fallback `DEFAULT_SETTINGS`
 * object so the query layer and every settings section share one canonical
 * schema instead of each keeping a hand-copied duplicate.
 *
 * P123 — a previous `useSettingsStore` Zustand mirror lived here but was never
 * hydrated nor consumed anywhere, making it a stale third source of truth. It
 * has been removed; only the shared defaults remain.
 */

import type { AppSettings } from "@/lib/tauri";

export const DEFAULT_SETTINGS: AppSettings = {
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
  hands_free_enabled: false,
};
