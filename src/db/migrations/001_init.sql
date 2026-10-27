-- 001_init.sql
-- Initial CyberSafe schema: identity, learning content, and assessments.
--
-- Conventions
--   * All timestamps are ISO-8601 UTC strings (TEXT) so the schema stays
--     portable to PostgreSQL / MySQL when a managed database is introduced.
--   * Enumerations are enforced with CHECK constraints instead of SQLite
--     specific types.
--   * Quiz content is version pinned: one row in `quizzes` is one immutable
--     version. Editing a published quiz means inserting a new version, so
--     historical attempts keep pointing at exactly what the student saw.
--   * Foreign keys default to RESTRICT where deleting a row would destroy
--     assessment history.

CREATE TABLE users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub         TEXT    NOT NULL,
  email              TEXT    NOT NULL,
  email_verified     INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  username           TEXT,
  display_name       TEXT,
  role               TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  status             TEXT    NOT NULL DEFAULT 'pending_setup'
                       CHECK (status IN ('pending_setup', 'active', 'disabled')),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  last_login_at      TEXT,
  setup_completed_at TEXT,
  CONSTRAINT users_google_sub_unique UNIQUE (google_sub),
  CONSTRAINT users_username_required_when_active
    CHECK (status = 'pending_setup' OR (username IS NOT NULL AND display_name IS NOT NULL))
);

-- Usernames are only unique among accounts that actually have one; a
-- half-finished signup must not reserve a username forever.
CREATE UNIQUE INDEX users_username_unique
  ON users (LOWER(username))
  WHERE username IS NOT NULL;

CREATE INDEX users_email_lookup ON users (email);
CREATE INDEX users_role_status ON users (role, status);

CREATE TABLE sessions (
  -- SHA-256 of the opaque cookie token. The raw token never touches the
  -- database, so a leaked database cannot be replayed as a login.
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  last_seen_at TEXT    NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT
);

CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- Short-lived, single-use OpenID Connect handshake state (CSRF `state`,
-- replay `nonce`, and the PKCE verifier).
CREATE TABLE oidc_states (
  state         TEXT PRIMARY KEY,
  nonce         TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to     TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE TABLE lessons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  summary         TEXT    NOT NULL DEFAULT '',
  category        TEXT    NOT NULL
                    CHECK (category IN ('phishing', 'passwords', 'scams', 'privacy', 'ethics')),
  content         TEXT    NOT NULL DEFAULT '',
  reading_minutes INTEGER NOT NULL DEFAULT 4 CHECK (reading_minutes > 0),
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'archived')),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  published_at    TEXT
);

CREATE INDEX lessons_status_category ON lessons (status, category);
CREATE INDEX lessons_category ON lessons (category);

CREATE TABLE lesson_progress (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id    INTEGER NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  state        TEXT    NOT NULL DEFAULT 'in_progress'
                 CHECK (state IN ('in_progress', 'completed')),
  started_at   TEXT    NOT NULL,
  completed_at TEXT,
  updated_at   TEXT    NOT NULL,
  CONSTRAINT lesson_progress_unique UNIQUE (user_id, lesson_id)
);

CREATE INDEX lesson_progress_lesson ON lesson_progress (lesson_id);

CREATE TABLE quizzes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT    NOT NULL,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  title                 TEXT    NOT NULL,
  description           TEXT    NOT NULL DEFAULT '',
  status                TEXT    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'published', 'archived')),
  passing_score_percent INTEGER NOT NULL DEFAULT 70
                          CHECK (passing_score_percent BETWEEN 0 AND 100),
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL,
  published_at          TEXT,
  CONSTRAINT quizzes_slug_version_unique UNIQUE (slug, version)
);

CREATE INDEX quizzes_status ON quizzes (status, slug);

CREATE TABLE quiz_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes (id) ON DELETE RESTRICT,
  position    INTEGER NOT NULL CHECK (position > 0),
  prompt      TEXT    NOT NULL,
  explanation TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,
  CONSTRAINT quiz_questions_position_unique UNIQUE (quiz_id, position)
);

CREATE INDEX quiz_questions_quiz ON quiz_questions (quiz_id, position);

CREATE TABLE quiz_options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES quiz_questions (id) ON DELETE RESTRICT,
  position    INTEGER NOT NULL CHECK (position > 0),
  label       TEXT    NOT NULL,
  is_correct  INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  CONSTRAINT quiz_options_position_unique UNIQUE (question_id, position)
);

CREATE INDEX quiz_options_question ON quiz_options (question_id, position);

CREATE TABLE quiz_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  quiz_id      INTEGER NOT NULL REFERENCES quizzes (id) ON DELETE RESTRICT,
  status       TEXT    NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'submitted', 'expired')),
  score_points INTEGER NOT NULL DEFAULT 0 CHECK (score_points >= 0),
  max_points   INTEGER NOT NULL DEFAULT 0 CHECK (max_points >= 0),
  started_at   TEXT    NOT NULL,
  submitted_at TEXT
);

CREATE INDEX quiz_attempts_user ON quiz_attempts (user_id, submitted_at);
CREATE INDEX quiz_attempts_quiz ON quiz_attempts (quiz_id);

CREATE TABLE attempt_answers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id         INTEGER NOT NULL REFERENCES quiz_attempts (id) ON DELETE CASCADE,
  question_id        INTEGER NOT NULL REFERENCES quiz_questions (id) ON DELETE RESTRICT,
  selected_option_id INTEGER REFERENCES quiz_options (id) ON DELETE RESTRICT,
  is_correct         INTEGER CHECK (is_correct IN (0, 1)),
  answered_at        TEXT    NOT NULL,
  CONSTRAINT attempt_answers_unique UNIQUE (attempt_id, question_id)
);

CREATE INDEX attempt_answers_attempt ON attempt_answers (attempt_id);

-- Published assessment content is immutable. A change requires a new
-- `quizzes` row (version + 1) with copied questions, which keeps every old
-- attempt explainable.
CREATE TRIGGER quiz_questions_published_update_guard
BEFORE UPDATE ON quiz_questions
WHEN (SELECT status FROM quizzes WHERE id = OLD.quiz_id) IN ('published', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'published quiz questions are immutable - create a new quiz version');
END;

CREATE TRIGGER quiz_questions_published_delete_guard
BEFORE DELETE ON quiz_questions
WHEN (SELECT status FROM quizzes WHERE id = OLD.quiz_id) IN ('published', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'published quiz questions are immutable - archive the quiz version instead');
END;

CREATE TRIGGER quiz_options_published_update_guard
BEFORE UPDATE ON quiz_options
WHEN (
  SELECT q.status FROM quizzes q
  JOIN quiz_questions qq ON qq.quiz_id = q.id
  WHERE qq.id = OLD.question_id
) IN ('published', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'published quiz options are immutable - create a new quiz version');
END;

CREATE TRIGGER quiz_options_published_delete_guard
BEFORE DELETE ON quiz_options
WHEN (
  SELECT q.status FROM quizzes q
  JOIN quiz_questions qq ON qq.quiz_id = q.id
  WHERE qq.id = OLD.question_id
) IN ('published', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'published quiz options are immutable - archive the quiz version instead');
END;

-- A submitted attempt is part of a student's record and cannot be rewritten.
CREATE TRIGGER quiz_attempts_submitted_update_guard
BEFORE UPDATE ON quiz_attempts
WHEN OLD.status = 'submitted' AND NEW.status <> 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'submitted quiz attempts are immutable');
END;

CREATE TRIGGER attempt_answers_submitted_update_guard
BEFORE UPDATE ON attempt_answers
WHEN (SELECT status FROM quiz_attempts WHERE id = OLD.attempt_id) = 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'answers of submitted attempts are immutable');
END;
