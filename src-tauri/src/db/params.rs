//! FSRS parameter storage.
//!
//! The `fsrs_params` table has at most one row (id=1) holding the 21-element
//! parameter vector (serialised as JSON). The optimiser (agent A3) bumps the
//! row whenever it re-fits on accumulated review history.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};

pub struct ParamsRepo<'a> {
    conn: &'a Connection,
}

impl<'a> ParamsRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Fetch the active FSRS parameter vector. Errors with `NotFound` if the
    /// seed row is missing (which would be a setup bug — `db::init` seeds it).
    pub fn get(&self) -> AppResult<Vec<f32>> {
        let row: Option<String> = self
            .conn
            .query_row(
                "SELECT params_json FROM fsrs_params WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let s = row.ok_or_else(|| AppError::NotFound("fsrs_params row".into()))?;
        let v: Vec<f32> = serde_json::from_str(&s)?;
        Ok(v)
    }

    /// Replace the active parameter vector. `optimized_at` is the unix ts of
    /// the optimisation run (None for the initial seed). `reviews_at_optim`
    /// records the size of the dataset used so we can decide when to re-fit.
    pub fn set(
        &self,
        params_vec: Vec<f32>,
        optimized_at: Option<i64>,
        reviews_at_optim: i64,
    ) -> AppResult<()> {
        let json = serde_json::to_string(&params_vec)?;
        self.conn.execute(
            "INSERT INTO fsrs_params (id, params_json, optimized_at, reviews_at_optim)
             VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                params_json = excluded.params_json,
                optimized_at = excluded.optimized_at,
                reviews_at_optim = excluded.reviews_at_optim",
            params![json, optimized_at, reviews_at_optim],
        )?;
        Ok(())
    }
}
