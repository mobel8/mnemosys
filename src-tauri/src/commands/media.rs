//! Media-asset copy commands.
//!
//! Used by the image-occlusion editor: the user picks an image from anywhere
//! on disk, we copy it into `<app_data_dir>/occlusion-media/` so the file
//! lives inside the Tauri allowlist scope and can be served back via
//! `convertFileSrc()` from the frontend.
//!
//! The destination filename is content-addressed (`<sha256-prefix>-<basename>`)
//! so that re-importing the same picture is a free no-op and identical
//! pictures share storage. The prefix is the first 16 hex chars of SHA-256,
//! which is plenty to avoid collisions in a personal collection.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Sub-directory of `app_data_dir` where occlusion images live.
const OCCLUSION_DIR: &str = "occlusion-media";

/// Hard cap on the source file size we accept. Picked large enough for a
/// reasonable PNG/JPEG/WebP but small enough that we don't accidentally
/// shovel a 200 MB raw camera dump into the user's profile.
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

/// Sanitise a source basename for use on disk. Collapses anything outside
/// `[A-Za-z0-9.-]` to `_` and trims to a sane length so we don't generate
/// pathological filenames on Windows / ecryptfs.
fn sanitise_basename(raw: &str) -> String {
    let mut out: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() {
        out = "image".to_string();
    }
    if out.len() > 80 {
        out.truncate(80);
    }
    out
}

/// Compute the SHA-256 hex digest of `bytes` and return the first 16 chars.
fn short_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(16);
    for b in digest.iter().take(8) {
        hex.push_str(&format!("{:02x}", b));
    }
    hex
}

/// Resolve `<app_data_dir>/occlusion-media`, creating it if necessary.
pub(crate) fn ensure_occlusion_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir unavailable: {}", e)))?;
    let dir = base.join(OCCLUSION_DIR);
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Public, testable core: given the bytes of an image, a source filename and
/// a destination directory, returns the absolute path of the copied file
/// (writing it if absent, no-op otherwise).
pub fn copy_image_bytes_into(
    bytes: &[u8],
    source_basename: &str,
    dest_dir: &Path,
) -> AppResult<PathBuf> {
    if bytes.is_empty() {
        return Err(AppError::Validation("image is empty".into()));
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::Validation(format!(
            "image is too large ({} bytes, max {})",
            bytes.len(),
            MAX_IMAGE_BYTES
        )));
    }
    let prefix = short_hash(bytes);
    let safe = sanitise_basename(source_basename);
    let target = dest_dir.join(format!("{}-{}", prefix, safe));
    if !target.exists() {
        std::fs::write(&target, bytes)?;
    }
    Ok(target)
}

/// Copy an arbitrary image from `source_path` into the per-app
/// `occlusion-media` directory. Returns the absolute path of the copy so
/// the frontend can pass it through `convertFileSrc()` later on.
#[tauri::command]
pub fn copy_image_to_app_data(app: AppHandle, source_path: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(AppError::Validation(format!(
            "source image does not exist: {}",
            source_path
        )));
    }
    let metadata = std::fs::metadata(&src)?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Validation(format!(
            "image is too large ({} bytes, max {})",
            metadata.len(),
            MAX_IMAGE_BYTES
        )));
    }
    let bytes = std::fs::read(&src)?;
    let basename = src
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_string());

    let dest_dir = ensure_occlusion_dir(&app)?;
    let dest = copy_image_bytes_into(&bytes, &basename, &dest_dir)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile_workaround as tempdir;

    /// Minimal in-tree tempdir helper: we keep tests hermetic without pulling
    /// in `tempfile` as a dev-dep. The directory is removed on drop.
    mod tempfile_workaround {
        use std::path::{Path, PathBuf};

        pub struct TempDir(PathBuf);
        impl TempDir {
            pub fn new(name: &str) -> Self {
                let mut p = std::env::temp_dir();
                p.push(format!(
                    "mnemosys-occlusion-test-{}-{}",
                    name,
                    std::process::id()
                ));
                std::fs::create_dir_all(&p).unwrap();
                Self(p)
            }
            pub fn path(&self) -> &Path {
                &self.0
            }
        }
        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn copy_image_bytes_into_writes_once_and_returns_path() {
        let dir = tempdir::TempDir::new("write_once");
        let bytes = b"\x89PNG\r\n\x1a\nfake-image";
        let p1 = copy_image_bytes_into(bytes, "photo.png", dir.path()).unwrap();
        assert!(p1.exists());
        let len1 = fs::metadata(&p1).unwrap().len();

        // Calling again with identical bytes is a no-op: same path, same size.
        let p2 = copy_image_bytes_into(bytes, "photo.png", dir.path()).unwrap();
        assert_eq!(p1, p2);
        assert_eq!(len1, fs::metadata(&p2).unwrap().len());
    }

    #[test]
    fn copy_image_bytes_into_rejects_empty() {
        let dir = tempdir::TempDir::new("empty");
        let err = copy_image_bytes_into(b"", "x.png", dir.path()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn sanitise_basename_strips_unsafe_chars() {
        assert_eq!(sanitise_basename("a b/c.png"), "a_b_c.png");
        assert_eq!(sanitise_basename(""), "image");
    }
}
