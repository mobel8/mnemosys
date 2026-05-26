-- v5__confidence_rating.sql
-- Cognitive features (Vague 2): confidence-based metacognition (Gardner-Medwin UCL).
--
-- Adds an optional `confidence` column to `reviews` storing the learner's
-- self-rated confidence in [1..5] BEFORE seeing the FSRS rating buttons.
-- NULL means « confidence rating was not collected for this review » so the
-- column is backward-compatible with reviews logged before v5.

ALTER TABLE reviews ADD COLUMN confidence INTEGER;
