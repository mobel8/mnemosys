//! HTTP client for Supabase PostgREST endpoints.
//!
//! Status: **scaffolding**. Methods compile and carry the right reqwest
//! plumbing so Session 4 can flesh them out, but the push/pull bodies
//! currently return empty payloads — there's no project to talk to yet.
//! Calls from `sync::orchestrate` therefore always go through, just with
//! zero remote work performed.
//!
//! Why we still ship the skeleton: the rest of the pipeline (delta
//! extraction, LWW merge, sync_state cursor advance) can be exercised
//! end-to-end with an empty remote, which is exactly what the unit tests
//! lean on.

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::auth::SupabaseConfig;

/// Remote shape for a deck row (UUID PK + tombstone column). Kept independent
/// from the local `Deck` struct so a schema drift between the two stays
/// explicit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteDeck {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub desired_retention: f64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// Remote shape for a note row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteNote {
    pub id: String,
    pub deck_id: String,
    pub template: String,
    pub fields: serde_json::Value,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// Remote shape for a card row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteCard {
    pub id: String,
    pub note_id: String,
    pub deck_id: String,
    pub card_ord: i64,
    pub state: String,
    pub stability: Option<f64>,
    pub difficulty: Option<f64>,
    pub last_review: Option<i64>,
    pub next_review: Option<i64>,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub suspended: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// Remote shape for a review row — append-only, no tombstone needed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteReview {
    pub id: String,
    pub card_id: String,
    pub rating: i64,
    pub state_before: String,
    pub state_after: String,
    pub stability_before: Option<f64>,
    pub stability_after: f64,
    pub difficulty_before: Option<f64>,
    pub difficulty_after: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub review_time: i64,
    pub reviewed_at: i64,
}

/// Pre-built reqwest client carrying the auth + project headers. Keep one
/// per sync cycle — reqwest pools the underlying TCP connections.
pub struct SyncClient {
    http: reqwest::Client,
    base_url: String,
}

impl SyncClient {
    /// Build a client with the canonical Supabase headers. The JWT is bound
    /// at construction time so individual calls stay terse.
    pub fn new(config: &SupabaseConfig, access_token: &str) -> AppResult<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(
            "apikey",
            HeaderValue::from_str(&config.anon_key)
                .map_err(|e| AppError::Other(format!("invalid anon key header: {}", e)))?,
        );
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", access_token))
                .map_err(|e| AppError::Other(format!("invalid bearer header: {}", e)))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| AppError::Other(format!("reqwest build failed: {}", e)))?;

        Ok(Self {
            http,
            base_url: config.url.clone(),
        })
    }

    /// `GET /rest/v1/decks?updated_at=gt.<since>`. Returns the rows whose
    /// `updated_at` is strictly greater than `since`. With no remote yet,
    /// the body is empty so the deserializer yields `vec![]`.
    pub async fn pull_decks(&self, since: i64) -> AppResult<Vec<RemoteDeck>> {
        let url = format!(
            "{}/rest/v1/decks?updated_at=gt.{}&order=updated_at.asc",
            self.base_url, since
        );
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("pull_decks: {}", e)))?;
        decode_or_empty(resp).await
    }

    /// `POST /rest/v1/decks` (upsert via `Prefer: resolution=merge-duplicates`).
    pub async fn push_decks(&self, batch: &[RemoteDeck]) -> AppResult<Vec<RemoteDeck>> {
        if batch.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!("{}/rest/v1/decks", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header(
                "Prefer",
                "resolution=merge-duplicates,return=representation",
            )
            .json(batch)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("push_decks: {}", e)))?;
        decode_or_empty(resp).await
    }

    pub async fn pull_notes(&self, since: i64) -> AppResult<Vec<RemoteNote>> {
        let url = format!(
            "{}/rest/v1/notes?updated_at=gt.{}&order=updated_at.asc",
            self.base_url, since
        );
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("pull_notes: {}", e)))?;
        decode_or_empty(resp).await
    }

    pub async fn push_notes(&self, batch: &[RemoteNote]) -> AppResult<Vec<RemoteNote>> {
        if batch.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!("{}/rest/v1/notes", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header(
                "Prefer",
                "resolution=merge-duplicates,return=representation",
            )
            .json(batch)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("push_notes: {}", e)))?;
        decode_or_empty(resp).await
    }

    pub async fn pull_cards(&self, since: i64) -> AppResult<Vec<RemoteCard>> {
        let url = format!(
            "{}/rest/v1/cards?updated_at=gt.{}&order=updated_at.asc",
            self.base_url, since
        );
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("pull_cards: {}", e)))?;
        decode_or_empty(resp).await
    }

    pub async fn push_cards(&self, batch: &[RemoteCard]) -> AppResult<Vec<RemoteCard>> {
        if batch.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!("{}/rest/v1/cards", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header(
                "Prefer",
                "resolution=merge-duplicates,return=representation",
            )
            .json(batch)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("push_cards: {}", e)))?;
        decode_or_empty(resp).await
    }

    pub async fn pull_reviews(&self, since: i64) -> AppResult<Vec<RemoteReview>> {
        let url = format!(
            "{}/rest/v1/reviews?reviewed_at=gt.{}&order=reviewed_at.asc",
            self.base_url, since
        );
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("pull_reviews: {}", e)))?;
        decode_or_empty(resp).await
    }

    pub async fn push_reviews(&self, batch: &[RemoteReview]) -> AppResult<Vec<RemoteReview>> {
        if batch.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!("{}/rest/v1/reviews", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header("Prefer", "return=representation")
            .json(batch)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("push_reviews: {}", e)))?;
        decode_or_empty(resp).await
    }
}

/// Helper: a 200 with no body (or `[]`) yields `Ok(vec![])`. Any non-2xx
/// status is folded into `AppError::Other` so the orchestrator can surface
/// it without leaking reqwest internals.
async fn decode_or_empty<T>(resp: reqwest::Response) -> AppResult<Vec<T>>
where
    T: for<'de> Deserialize<'de>,
{
    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!(
            "supabase returned {}: {}",
            status, detail
        )));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("read response: {}", e)))?;
    if body.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&body).map_err(|e| AppError::Other(format!("decode response: {}", e)))
}
