//! On-disk MP3 cache for synthesised speech.
//!
//! Keying strategy
//! ---------------
//! `SHA-256(text || voice || speed_le_bytes)` — covers every parameter that
//! changes the generated audio. Voice is hashed as its string slug (matching
//! [`super::openai::Voice::as_str`]) so the key stays stable across enum
//! reorderings.
//!
//! Layout
//! ------
//! Flat directory of `<hex>.mp3` files. No subsharding (a power user is
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
pub struct TTSCache {
    base_dir: PathBuf,
}

impl TTSCache {
    /// Open (or create) the cache directory. Returns the cache; the
    /// directory is created with default permissions if it doesn't exist.
    pub fn new(base_dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&base_dir)?;
        Ok(Self { base_dir })
    }

    /// Deterministic cache key — `<hex sha256>.mp3`.
    ///
    /// `speed` is hashed via `to_le_bytes` so the encoding is platform-stable.
    fn key(text: &str, voice: &str, speed: f32) -> String {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        hasher.update(voice.as_bytes());
        hasher.update(speed.to_le_bytes());
        format!("{:x}.mp3", hasher.finalize())
    }

    /// Absolute path the key would resolve to. Does not touch the disk.
    pub fn path_for(&self, text: &str, voice: &str, speed: f32) -> PathBuf {
        self.base_dir.join(Self::key(text, voice, speed))
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

    /// Wipe every `*.mp3` file in the cache directory. Non-`.mp3` files (if
    /// any user dropped some in by hand) are left alone.
    pub fn clear(&self) -> std::io::Result<()> {
        for entry in fs::read_dir(&self.base_dir)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|e| e == "mp3") {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}
