-- 006_quiz_module.sql
-- Optional module a quiz belongs to. The quiz is listed on that module's page
-- once it has a published version; clearing the link keeps the quiz in the
-- general catalogue only.

ALTER TABLE quizzes ADD COLUMN module_id INTEGER REFERENCES modules (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quizzes_module ON quizzes (module_id, status, slug);
