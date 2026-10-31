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
function convertLessonsToModules(db) {
  const { CATEGORIES } = require('../src/content/categories');
  const lessonsDb = require('../src/db/lessons');
  const modulesDb = require('../src/db/modules');
  const quizzesDb = require('../src/db/quizzes');

  for (const cat of CATEGORIES) {
    // Idempotent: skip if module already exists
    const existing = db.prepare('SELECT id FROM modules WHERE title = ?').get(cat.label);
    let mod;
    if (existing) {
      mod = modulesDb.findById(db, existing.id);
    } else {
      mod = modulesDb.createModule(db, {
        title: cat.label,
        description: cat.description,
        status: 'published',
        sortOrder: 0,
      });
    }

    // Get published lessons for this category
    const lessons = db.prepare("SELECT * FROM lessons WHERE category = ? AND status = 'published' ORDER BY title").all(cat.key);
    const existingItems = modulesDb.listItems(db, mod.id);
    const existingTitles = new Set(existingItems.map(i => i.title));

    // Add lesson pages
    let sortOrder = existingItems.length;
    for (const lesson of lessons) {
      if (existingTitles.has(lesson.title)) continue;
      const item = modulesDb.addItem(db, {
        moduleId: mod.id,
        type: 'page',
        title: lesson.title,
        content: lesson.content || '',
        sortOrder: sortOrder++,
      });
      existingTitles.add(lesson.title);

      // Carry over lesson completion
      const completions = db.prepare("SELECT user_id FROM lesson_progress WHERE lesson_id = ? AND state = 'completed'").all(lesson.id);
      for (const comp of completions) {
        modulesDb.markComplete(db, comp.user_id, item.id);
      }
    }

    // Add quizzes matching this category
    const quizzes = db.prepare("SELECT * FROM quizzes WHERE status = 'published'").all();
    const catKey = cat.key.replace(/s$/, ''); // 'passwords' -> 'password'
    for (const quiz of quizzes) {
      if (!quiz.slug.toLowerCase().includes(cat.key) && !quiz.slug.toLowerCase().includes(catKey)) continue;
      // Check if already added
      const hasQuiz = existingItems.some(i => i.type === 'quiz' && i.quiz_id === quiz.id);
      if (hasQuiz) continue;
      // Also check by title
      const quizTitle = quiz.title;
      if (existingTitles.has(quizTitle)) continue;
      modulesDb.addItem(db, {
        moduleId: mod.id,
        type: 'quiz',
        title: quizTitle,
        quizId: quiz.id,
        sortOrder: sortOrder++,
      });
      existingTitles.add(quizTitle);
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

    // Convert lessons to modules
    convertLessonsToModules(db);
    console.log('Applied lesson-to-module conversion.');

    console.log(`Database file: ${config.database.file}`);
  } finally {
    db.close();
  }
}

main();
