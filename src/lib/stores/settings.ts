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
  // Active recall options — opt-in.
  type_the_answer_enabled: false,
  confidence_rating_enabled: false,
  // Labs — opt-in.
  sketch_before_flip_enabled: false,
  voice_answer_enabled: false,
  hands_free_enabled: false,
  ambient_sound: "none",
  // Local AI (Ollama).
  ollama_enabled: false,
  ollama_url: null,
  ollama_model: null,
};
