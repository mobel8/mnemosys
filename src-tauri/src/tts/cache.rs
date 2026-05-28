//! On-disk MP3 cache for synthesised speech.
//!
//! Keying strategy
//! ---------------
//! `SHA-256(text || voice || speed_le_bytes)` — covers every parameter that
//! changes the generated audio. Voice is hashed as its string slug (matching
//! [`super::openai::Voice::as_str`]) so the key stays stable across enum
//! reorderings. The local Piper path (Vague 22) reuses the same cache but
//! passes a voice slug of the form `piper:<model>` so its entries can never
//! collide with the cloud OpenAI ones even for identical text.
//!
//! Layout
//! ------
//! Flat directory of `<hex>.<ext>` files. The OpenAI path writes `.mp3`; the
//! Piper path (Vague 22) writes `.wav`. No subsharding (a power user is
//! unlikely to ever exceed a few thousand files; ext4/APFS/NTFS all handle
//! that flat with sub-millisecond `readdir` latencies).
//!
//! Concurrency
//! -----------
//! No internal locking. Two concurrent writes for the same key would race
//! and one would clobber the other, but the result is byte-identical (same
//! API response), so the race is benign.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

/// Disk-backed TTS cache rooted at `base_dir`.
///
/// `ext` is the on-disk file extension (no leading dot): `"mp3"` for the
/// OpenAI path, `"wav"` for the local Piper path. Both share the same
/// directory; the SHA-256 key already incorporates the voice slug so a
/// Piper entry (`piper:<model>` voice) never aliases an OpenAI one.
pub struct TTSCache {
    base_dir: PathBuf,
    ext: &'static str,
}

impl TTSCache {
    /// Open (or create) an MP3 cache directory (OpenAI path). The directory
    /// is created with default permissions if it doesn't exist.
    pub fn new(base_dir: PathBuf) -> std::io::Result<Self> {
        Self::new_with_ext(base_dir, "mp3")
    }

    /// Open (or create) a cache directory using a specific file extension.
    /// Used by the Piper path (Vague 22) with `"wav"`.
    pub fn new_with_ext(base_dir: PathBuf, ext: &'static str) -> std::io::Result<Self> {
        fs::create_dir_all(&base_dir)?;
        Ok(Self { base_dir, ext })
    }

    /// Deterministic cache key — `<hex sha256>.<ext>`.
    ///
    /// `speed` is hashed via `to_le_bytes` so the encoding is platform-stable.
    fn key(&self, text: &str, voice: &str, speed: f32) -> String {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        hasher.update(voice.as_bytes());
        hasher.update(speed.to_le_bytes());
        format!("{:x}.{}", hasher.finalize(), self.ext)
    }

    /// Absolute path the key would resolve to. Does not touch the disk.
    pub fn path_for(&self, text: &str, voice: &str, speed: f32) -> PathBuf {
        self.base_dir.join(self.key(text, voice, speed))
    }

    /// `true` iff the cache already holds this exact `(text, voice, speed)`.
    pub fn exists(&self, text: &str, voice: &str, speed: f32) -> bool {
        self.path_for(text, voice, speed).exists()
    }

    /// Read the cached MP3 bytes, or `None` on miss.
    pub fn read(&self, text: &str, voice: &str, speed: f32) -> Option<Vec<u8>> {
        fs::read(self.path_for(text, voice, speed)).ok()
    }

    /// Persist `audio` and return the absolute path it landed at.
    pub fn write(
        &self,
        text: &str,
        voice: &str,
        speed: f32,
        audio: &[u8],
    ) -> std::io::Result<PathBuf> {
        let path = self.path_for(text, voice, speed);
        fs::write(&path, audio)?;
        Ok(path)
    }

    /// Wipe every synthesised-audio file (`*.mp3` from OpenAI and `*.wav` from
    /// Piper) in the cache directory. Any other file a user dropped in by hand
    /// is left alone. Clearing is extension-driven rather than instance-driven
    /// so the single "Vider le cache" button removes both cloud and local
    /// output regardless of which `TTSCache` triggered it.
    pub fn clear(&self) -> std::io::Result<()> {
        for entry in fs::read_dir(&self.base_dir)? {
            let entry = entry?;
            let is_audio = entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e == "mp3" || e == "wav");
            if is_audio {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}
