-- 002_attempt_integrity.sql
-- Phase 2 adds the quiz-taking flow. The Phase 1 schema already stores
-- attempts, scores, and per-question answers, so this migration only adds the
-- constraints needed to keep that data trustworthy:
--
--   * a student may have at most one open attempt per quiz version, which
--     makes "Start quiz" idempotent even under a double submit;
--   * submitted attempts are fully immutable at the database layer, not only
--     by convention in the route handlers;
--   * answers cannot be inserted into an attempt that is already submitted.

CREATE UNIQUE INDEX quiz_attempts_one_open_per_version
  ON quiz_attempts (user_id, quiz_id)
  WHERE status = 'in_progress';

CREATE INDEX quiz_attempts_user_status
  ON quiz_attempts (user_id, status, submitted_at DESC);

DROP TRIGGER IF EXISTS quiz_attempts_submitted_update_guard;

CREATE TRIGGER quiz_attempts_submitted_update_guard
BEFORE UPDATE ON quiz_attempts
WHEN OLD.status = 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'submitted quiz attempts are immutable');
END;

CREATE TRIGGER attempt_answers_submitted_insert_guard
BEFORE INSERT ON attempt_answers
WHEN (SELECT status FROM quiz_attempts WHERE id = NEW.attempt_id) = 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'answers of submitted attempts are immutable');
END;
