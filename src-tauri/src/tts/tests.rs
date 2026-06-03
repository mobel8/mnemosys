//! Unit tests for the TTS module.
//!
//! All tests are filesystem- or pure-compute only — no network calls,
//! so they run as fast as the rest of the suite. Each test that touches
//! disk allocates its own temp directory under `std::env::temp_dir()`
//! and cleans up on drop via [`TempDir`].

use super::cache::TTSCache;
use super::openai::{OpenAIClient, TTSError, Voice};
use super::piper::{piper_args, synthesize_piper};
use crate::error::AppError;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Temp directory helper — keeps each test isolated.
// ---------------------------------------------------------------------------

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        // Use nanos + label so parallel test invocations don't collide.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("mnemosys-tts-test-{label}-{nanos}"));
        fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }
    fn path(&self) -> PathBuf {
        self.0.clone()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

#[test]
fn voice_as_str_matches_openai_slugs() {
    assert_eq!(Voice::Alloy.as_str(), "alloy");
    assert_eq!(Voice::Echo.as_str(), "echo");
    assert_eq!(Voice::Fable.as_str(), "fable");
    assert_eq!(Voice::Onyx.as_str(), "onyx");
    assert_eq!(Voice::Nova.as_str(), "nova");
    assert_eq!(Voice::Shimmer.as_str(), "shimmer");
    assert_eq!(Voice::Coral.as_str(), "coral");
    assert_eq!(Voice::Sage.as_str(), "sage");
}

#[test]
fn voice_serialises_lowercase() {
    let s = serde_json::to_string(&Voice::Nova).unwrap();
    assert_eq!(s, "\"nova\"");
    let v: Voice = serde_json::from_str("\"shimmer\"").unwrap();
    assert_eq!(v, Voice::Shimmer);
}

// ---------------------------------------------------------------------------
// TTSError
// ---------------------------------------------------------------------------

#[tokio::test]
async fn synthesize_returns_no_api_key_when_empty() {
    let client = OpenAIClient::new(String::new());
    let err = client
        .synthesize("hello", Voice::Nova, 1.0)
        .await
        .expect_err("empty key must short-circuit before any network call");
    assert!(matches!(err, TTSError::NoApiKey));
}

// ---------------------------------------------------------------------------
// TTSCache — keying
// ---------------------------------------------------------------------------

#[test]
fn cache_key_is_deterministic_for_identical_inputs() {
    let tmp = TempDir::new("det");
    let cache = TTSCache::new(tmp.path()).unwrap();
    let a = cache.path_for("Bonjour le monde", "nova", 1.0);
    let b = cache.path_for("Bonjour le monde", "nova", 1.0);
    assert_eq!(a, b);
}

#[test]
fn cache_key_differs_when_text_differs() {
    let tmp = TempDir::new("text");
    let cache = TTSCache::new(tmp.path()).unwrap();
    let a = cache.path_for("hello", "nova", 1.0);
    let b = cache.path_for("hello!", "nova", 1.0);
    assert_ne!(a, b, "single-char change in text must change the cache key");
}

#[test]
fn cache_key_differs_when_voice_differs() {
    let tmp = TempDir::new("voice");
    let cache = TTSCache::new(tmp.path()).unwrap();
    let a = cache.path_for("hello", "nova", 1.0);
    let b = cache.path_for("hello", "shimmer", 1.0);
    assert_ne!(a, b);
}

#[test]
fn cache_key_differs_when_speed_differs() {
    let tmp = TempDir::new("speed");
    let cache = TTSCache::new(tmp.path()).unwrap();
    let a = cache.path_for("hello", "nova", 1.0);
    let b = cache.path_for("hello", "nova", 1.25);
    assert_ne!(a, b);
}

#[test]
fn cache_key_uses_mp3_extension() {
    let tmp = TempDir::new("ext");
    let cache = TTSCache::new(tmp.path()).unwrap();
    let p = cache.path_for("hello", "nova", 1.0);
    assert_eq!(p.extension().and_then(|s| s.to_str()), Some("mp3"));
}

#[test]
fn cache_with_ext_uses_wav_for_piper() {
    let tmp = TempDir::new("wav-ext");
    let cache = TTSCache::new_with_ext(tmp.path(), "wav").unwrap();
    let p = cache.path_for("bonjour", "piper:/voices/fr.onnx", 1.0);
    assert_eq!(p.extension().and_then(|s| s.to_str()), Some("wav"));
}

#[test]
fn cache_piper_and_openai_keys_never_collide() {
    // Same text + speed, but the Piper path uses a `piper:<model>` voice slug,
    // so its hash must differ from the OpenAI `nova` entry even though the two
    // share a directory. (Compare on the stem since the extensions differ.)
    let tmp = TempDir::new("collision");
    let openai = TTSCache::new(tmp.path()).unwrap();
    let piper = TTSCache::new_with_ext(tmp.path(), "wav").unwrap();
    let a = openai.path_for("hello", "nova", 1.0);
    let b = piper.path_for("hello", "piper:/voices/en.onnx", 1.0);
    assert_ne!(
        a.file_stem().unwrap(),
        b.file_stem().unwrap(),
        "piper and openai cache keys must not alias"
    );
}

// ---------------------------------------------------------------------------
// TTSCache — round-trip + maintenance
// ---------------------------------------------------------------------------

#[test]
fn cache_write_then_read_round_trip() {
    let tmp = TempDir::new("roundtrip");
    let cache = TTSCache::new(tmp.path()).unwrap();
    let payload: &[u8] = b"ID3\x03\x00\x00\x00fake-mp3-bytes";

    assert!(!cache.exists("salut", "nova", 1.0));
    let written = cache.write("salut", "nova", 1.0, payload).unwrap();
    assert!(written.exists());
    assert!(cache.exists("salut", "nova", 1.0));

    let read_back = cache.read("salut", "nova", 1.0).unwrap();
    assert_eq!(read_back, payload);
}

#[test]
fn cache_read_returns_none_on_miss() {
    let tmp = TempDir::new("miss");
    let cache = TTSCache::new(tmp.path()).unwrap();
    assert!(cache.read("never written", "nova", 1.0).is_none());
}

#[test]
fn cache_clear_removes_audio_files_only() {
    let tmp = TempDir::new("clear");
    let cache = TTSCache::new(tmp.path()).unwrap();

    cache.write("a", "nova", 1.0, b"a-bytes").unwrap();
    cache.write("b", "nova", 1.0, b"b-bytes").unwrap();

    // Also drop a Piper-style WAV so we prove clear() reaps both formats.
    let wav = tmp.path().join("deadbeef.wav");
    fs::write(&wav, b"RIFF....WAVE").unwrap();

    // Drop a non-audio file in there to verify clear() leaves it alone.
    let sentinel = tmp.path().join("README.txt");
    fs::write(&sentinel, b"do not delete").unwrap();

    cache.clear().unwrap();

    assert!(!cache.exists("a", "nova", 1.0));
    assert!(!cache.exists("b", "nova", 1.0));
    assert!(!wav.exists(), "clear() must also remove *.wav files");
    assert!(
        sentinel.exists(),
        "clear() must only remove *.mp3 / *.wav files"
    );
}

#[test]
fn cache_new_creates_dir_if_missing() {
    let tmp = TempDir::new("mkdir");
    let nested = tmp.path().join("nested").join("tts");
    assert!(!nested.exists());
    let _cache = TTSCache::new(nested.clone()).unwrap();
    assert!(nested.exists());
}

// ---------------------------------------------------------------------------
// Piper (Vague 22) — pure-compute / validation only, never spawns a process.
// ---------------------------------------------------------------------------

#[test]
fn piper_command_construction() {
    // The CLI contract is `piper --model <model> --output_file <out>` with the
    // text fed on stdin. We assert the exact argv so a refactor can't silently
    // reorder/rename the flags Piper expects.
    let out = Path::new("/tmp/mnemosys/out.wav");
    let args = piper_args("/voices/fr_FR-siwis-medium.onnx", out);
    assert_eq!(
        args,
        vec![
            "--model".to_string(),
            "/voices/fr_FR-siwis-medium.onnx".to_string(),
            "--output_file".to_string(),
            "/tmp/mnemosys/out.wav".to_string(),
        ]
    );
}

#[test]
fn piper_errors_clearly_when_model_path_blank() {
    // No process is spawned: the blank-model guard short-circuits first, so
    // this is safe and deterministic on any CI box without Piper installed.
    let tmp = TempDir::new("piper-nomodel");
    let out = tmp.path().join("x.wav");
    let err = synthesize_piper("piper", "  ", "bonjour", &out)
        .expect_err("blank model must fail before spawning");
    match err {
        AppError::Other(msg) => assert!(
            msg.contains("Piper indisponible") && msg.contains("modèle de voix"),
            "error should name the missing voice model, got: {msg}"
        ),
        other => panic!("expected AppError::Other, got {other:?}"),
    }
    assert!(!out.exists(), "no output file should be produced on error");
}

#[test]
fn piper_errors_clearly_when_model_file_missing() {
    // A non-blank but non-existent model path also fails before any spawn,
    // naming the path so the UI can tell the user exactly what to fix.
    let tmp = TempDir::new("piper-badmodel");
    let out = tmp.path().join("x.wav");
    let missing = tmp.path().join("does-not-exist.onnx");
    let err = synthesize_piper("piper", missing.to_str().unwrap(), "salut", &out)
        .expect_err("missing model file must fail before spawning");
    match err {
        AppError::Other(msg) => assert!(
            msg.contains("Piper indisponible") && msg.contains("introuvable"),
            "error should report the model file as not found, got: {msg}"
        ),
        other => panic!("expected AppError::Other, got {other:?}"),
    }
}

#[test]
fn piper_rejects_empty_text() {
    let tmp = TempDir::new("piper-emptytext");
    let out = tmp.path().join("x.wav");
    // Even with a (fake) model path, empty text is a validation error and
    // short-circuits before any model-file or process work.
    let err = synthesize_piper("piper", "/voices/x.onnx", "   ", &out)
        .expect_err("empty text must be rejected");
    assert!(matches!(err, AppError::Validation(_)));
}
