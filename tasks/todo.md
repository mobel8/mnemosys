# V22 — Compléments IA/audio (no DB migration, DB stays v16)

## Feature 1 — Piper TTS local
- [x] `tts/cache.rs`: generalize cache with extension param (mp3 default + wav for piper); `clear()` removes both
- [x] `tts/piper.rs` (new): `synthesize_piper(binary, model, text, out_path)` via process::Command, text on stdin
- [x] `tts/mod.rs`: register `pub mod piper`
- [x] `commands/tts.rs`: `synthesize_audio_local` cmd (piper, cache key "piper:<model>", wav)
- [x] `lib.rs`: register `synthesize_audio_local`
- [x] settings.rs: 3 fields piper_enabled/piper_binary_path/piper_model_path + defaults
- [x] Test: `piper_command_construction` (no real process)
- [x] tauri.ts: 3 AppSettings fields + api.tts.synthesizeLocal
- [x] queries.ts: route useSynthesizeAudio to piper when piper_enabled
- [x] IntegrationsSection: "TTS local (Piper)" section + 3 DEFAULTS fields

## Feature 2 — Mnemonic image (DALL-E)
- [x] `ai/image.rs` (new): `generate_image(key, prompt) -> path` (OpenAI Images API, save png under app_data/mnemonic-images/<sha>.png)
- [x] `ai/mod.rs`: register `pub mod image`
- [x] `commands/ai.rs`: `generate_card_mnemonic_image(card_id) -> path` + resolve OpenAI key
- [x] `lib.rs`: register cmd
- [x] Test: `mnemonic_image_prompt_from_card` (prompt build, no network)
- [x] tauri.ts + queries.ts: api.ai.generateMnemonicImage + useGenerateMnemonicImage
- [x] CardList: "Image mnémotechnique" menu item (lapses>=3) + dialog w/ convertFileSrc

## Feature 3 — Calibration rétrospectif
- [x] metacognition.rs: extend CalibrationStats with gamma_post/bias_post (Option<f64>) from reviews.confidence_post vs rating>=3
- [x] Test: `calibration_includes_retrospective`
- [x] tauri.ts CalibrationStats: + gamma_post/bias_post
- [x] CalibrationDashboard: 2nd line "Calibration rétrospective"

## Verifs finales
- [x] cargo test --no-fail-fast | grep "test result"
- [x] tsc --noEmit
- [x] biome check . | tail -3
- [x] cargo clippy --all-targets -- -D warnings | tail -3
- [x] vitest run --no-file-parallelism | tail -6

## Review (résultats)
- Rust: 235 + 55 tests OK, 1 ignored (FSRS). 12 nouveaux tests V22 verts.
- tsc: clean. biome: 202 fichiers, 0 erreur. clippy: 0 warning. vitest: 177/177 (41 fichiers).
- DB inchangée : CURRENT_VERSION = 16. Aucun nouveau .sql.
- 2 nouveaux fichiers (tts/piper.rs, ai/image.rs) ; 5 DEFAULTS mis à jour.
- Fix test : mock `useGenerateMnemonicImage` ajouté à mnemonic-helper.test.tsx (CardList l'importe désormais).
- Compromis : cache TTSCache généralisé (mp3+wav) ; routing Piper via getQueryData(settings) pour ne pas changer la signature de useSynthesizeAudio/TtsButton ; b64 décodé à la main (zéro dépendance Cargo) ; DALL·E en b64_json (un seul aller-retour).
