'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { openDatabase, runMigrations } = require('../src/db');

function applyProfileUpdates(db) {
  const stmts = [
    // username – nullable, will be indexed later
    `ALTER TABLE users ADD COLUMN username TEXT DEFAULT NULL;`,
    // biography
    `ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';`,
    // avatar URL (store the URL only; we'll keep initials for now)
    `ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT '';`,
    // notification preferences – stored as JSON text, default empty object
    `ALTER TABLE users ADD COLUMN notification_prefs TEXT DEFAULT '{}';`,
    // language & text‑size (appearance will be added later)
    `ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en';`,
    `ALTER TABLE users ADD COLUMN text_size TEXT DEFAULT 'medium';`,
  ];

  for (const sql of stmts) {
    try {
      db.exec(sql);
    } catch (e) {
      // Ignore "duplicate column" errors – makes the migration idempotent
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }

  // Create a partial unique index for username (null / empty strings are ignored)
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ` +
      `ON users(username) WHERE username IS NOT NULL AND username <> '';`
    );
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
}

function applyQuizFourOptions(db) {
  const questions = db.prepare('SELECT id FROM quiz_questions').all();
  for (const q of questions) {
    const opts = db.prepare('SELECT id, position, label, is_correct FROM quiz_options WHERE question_id = ? ORDER BY position').all(q.id);
    if (opts.length < 4) {
      const maxPos = opts.length > 0 ? Math.max.apply(null, opts.map(o => o.position)) : 0;
      for (let i = opts.length; i < 4; i++) {
        db.prepare('INSERT INTO quiz_options (question_id, position, label, is_correct) VALUES (?, ?, ?, ?)').run(q.id, maxPos + (i - opts.length + 1), '', 0);
      }
    } else if (opts.length > 4) {
      const correct = opts.find(o => o.is_correct === 1);
      const toKeep = opts.slice(0, 4);
      if (correct && toKeep.indexOf(correct) === -1) {
        toKeep[3] = correct;
      }
      const keepIds = toKeep.map(o => o.id);
      db.prepare('DELETE FROM quiz_options WHERE question_id = ? AND id NOT IN (' + keepIds.map(() => '?').join(',') + ')').run(q.id, ...keepIds);
    }
    const afterOpts = db.prepare('SELECT id, is_correct FROM quiz_options WHERE question_id = ? ORDER BY position').all(q.id);
    const correctCount = afterOpts.filter(o => o.is_correct === 1).length;
    if (correctCount !== 1 && afterOpts.length > 0) {
      if (correctCount === 0) {
        db.prepare('UPDATE quiz_options SET is_correct = 1 WHERE id = ?').run(afterOpts[0].id);
      } else if (correctCount > 1) {
        let found = false;
        for (const o of afterOpts) {
          if (o.is_correct === 1) {
            if (found) {
              db.prepare('UPDATE quiz_options SET is_correct = 0 WHERE id = ?').run(o.id);
            } else {
              found = true;
            }
          }
        }
      }
    }
  }
}
function main() {
  const config = loadConfig();
  const db = openDatabase(config.database.file);

  try {
    const applied = runMigrations(db);
    if (applied.length === 0) {
      console.log('Database is already up to date.');
    } else {
      for (const file of applied) console.log(`Applied migration: ${file}`);
    }

    // Apply our profile updates
    applyProfileUpdates(db);
    console.log('Applied profile updates.');

    // Normalize quiz questions to exactly 4 options (A-D)
    applyQuizFourOptions(db);
    console.log('Applied quiz A-D normalization.');

    console.log(`Database file: ${config.database.file}`);
  } finally {
    db.close();
  }
}

main();
