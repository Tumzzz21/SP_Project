-- 004_modules.sql
-- Learning modules (Blackboard-style) for structured content delivery.

CREATE TABLE IF NOT EXISTS modules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'hidden')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  require_sequential INTEGER NOT NULL DEFAULT 0 CHECK (require_sequential IN (0, 1)),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  published_at     TEXT
);

CREATE INDEX IF NOT EXISTS modules_status ON modules (status, sort_order);

CREATE TABLE IF NOT EXISTS module_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id    INTEGER NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
  type         TEXT    NOT NULL CHECK (type IN ('page', 'file', 'link', 'quiz')),
  title        TEXT    NOT NULL,
  content      TEXT    NOT NULL DEFAULT '',
  url          TEXT    NOT NULL DEFAULT '',
  file_path    TEXT    NOT NULL DEFAULT '',
  file_name    TEXT    NOT NULL DEFAULT '',
  file_size    INTEGER NOT NULL DEFAULT 0,
  quiz_id      INTEGER REFERENCES quizzes (id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS module_items_module ON module_items (module_id, sort_order);

CREATE TABLE IF NOT EXISTS module_item_progress (
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES module_items (id) ON DELETE CASCADE,
  completed_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS module_item_progress_user ON module_item_progress (user_id);
