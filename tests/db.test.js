'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase, runMigrations } = require('../src/db');

function freshDb() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

test('migrations create the expected tables and are idempotent', () => {
  const db = freshDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

  for (const table of [
    'users',
    'sessions',
    'oidc_states',
    'lessons',
    'lesson_progress',
    'quizzes',
    'quiz_questions',
    'quiz_options',
    'quiz_attempts',
    'attempt_answers',
    'schema_migrations',
  ]) {
    assert.ok(tables.includes(table), `missing table: ${table}`);
  }

  const appliedAgain = runMigrations(db);
  assert.deepEqual(appliedAgain, [], 'second run must not re-apply migrations');
  db.close();
});

test('foreign keys are enforced', () => {
  const db = freshDb();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO lesson_progress (user_id, lesson_id, state, started_at, updated_at)
           VALUES (9999, 9999, 'in_progress', 'now', 'now')`,
        )
        .run(),
    /FOREIGN KEY/i,
  );
  db.close();
});

test('usernames are unique regardless of case', () => {
  const db = freshDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO users (google_sub, email, email_verified, username, display_name, role, status, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'Name', 'student', 'active', ?, ?)`,
  );
  insert.run('sub-1', 'a@example.test', 'Ana', now, now);
  assert.throws(() => insert.run('sub-2', 'b@example.test', 'ana', now, now), /UNIQUE/i);
  db.close();
});

test('role and status values are constrained', () => {
  const db = freshDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO users (google_sub, email, username, display_name, role, status, created_at, updated_at)
     VALUES (?, ?, 'neo', 'Neo', ?, ?, ?, ?)`,
  );
  assert.throws(() => insert.run('sub-3', 'c@example.test', 'superadmin', 'active', now, now), /CHECK/i);
  assert.throws(() => insert.run('sub-4', 'd@example.test', 'student', 'suspended', now, now), /CHECK/i);
  db.close();
});

test('an active account must have a username and display name', () => {
  const db = freshDb();
  const now = new Date().toISOString();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO users (google_sub, email, role, status, created_at, updated_at)
           VALUES ('sub-5', 'e@example.test', 'student', 'active', ?, ?)`,
        )
        .run(now, now),
    /CHECK/i,
  );

  // A pending account may exist without a username until setup is finished.
  db.prepare(
    `INSERT INTO users (google_sub, email, role, status, created_at, updated_at)
     VALUES ('sub-6', 'f@example.test', 'student', 'pending_setup', ?, ?)`,
  ).run(now, now);
  db.close();
});

test('published quiz content is immutable', () => {
  const db = freshDb();
  const now = new Date().toISOString();
  const quizId = Number(
    db
      .prepare(
        `INSERT INTO quizzes (slug, version, title, description, status, created_at, updated_at, published_at)
         VALUES ('q', 1, 'Quiz', '', 'published', ?, ?, ?)`,
      )
      .run(now, now, now).lastInsertRowid,
  );
  const questionId = Number(
    db
      .prepare('INSERT INTO quiz_questions (quiz_id, position, prompt, created_at) VALUES (?, 1, ?, ?)')
      .run(quizId, 'Prompt?', now).lastInsertRowid,
  );
  const optionId = Number(
    db
      .prepare('INSERT INTO quiz_options (question_id, position, label, is_correct) VALUES (?, 1, ?, 1)')
      .run(questionId, 'Yes').lastInsertRowid,
  );

  assert.throws(
    () => db.prepare('UPDATE quiz_questions SET prompt = ? WHERE id = ?').run('Changed', questionId),
    /immutable/i,
  );
  assert.throws(
    () => db.prepare('DELETE FROM quiz_options WHERE id = ?').run(optionId),
    /immutable/i,
  );

  // A new version gets a fresh set of rows and leaves history untouched.
  const newQuizId = Number(
    db
      .prepare(
        `INSERT INTO quizzes (slug, version, title, description, status, created_at, updated_at)
         VALUES ('q', 2, 'Quiz v2', '', 'draft', ?, ?)`,
      )
      .run(now, now).lastInsertRowid,
  );
  assert.notEqual(newQuizId, quizId);
  db.close();
});

test('attempts pin the quiz version they were taken against', () => {
  const db = freshDb();
  const now = new Date().toISOString();
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users (google_sub, email, username, display_name, role, status, created_at, updated_at)
         VALUES ('sub-7', 'g@example.test', 'gina', 'Gina', 'student', 'active', ?, ?)`,
      )
      .run(now, now).lastInsertRowid,
  );
  const quizId = Number(
    db
      .prepare(
        `INSERT INTO quizzes (slug, version, title, description, status, created_at, updated_at)
         VALUES ('history-quiz', 1, 'Quiz', '', 'published', ?, ?)`,
      )
      .run(now, now).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO quiz_attempts (user_id, quiz_id, status, started_at, submitted_at)
     VALUES (?, ?, 'submitted', ?, ?)`,
  ).run(userId, quizId, now, now);

  // Deleting a quiz with recorded attempts would destroy history.
  assert.throws(() => db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId), /FOREIGN KEY/i);
  db.close();
});
