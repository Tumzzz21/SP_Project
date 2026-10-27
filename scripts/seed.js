'use strict';

/**
 * Insert the sample curriculum. Safe to run more than once: lessons are keyed
 * by slug and quiz content by (slug, version), so existing rows are skipped
 * instead of overwritten.
 */

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { openDatabase, runMigrations } = require('../src/db');
const { LESSONS, QUIZZES } = require('../src/content/seed-data');

const nowIso = () => new Date().toISOString();

function seedLessons(db) {
  const exists = db.prepare('SELECT id FROM lessons WHERE slug = ?');
  const insert = db.prepare(
    `INSERT INTO lessons (slug, title, summary, category, content, reading_minutes, status, created_at, updated_at, published_at)
     VALUES (@slug, @title, @summary, @category, @content, @readingMinutes, 'published', @now, @now, @now)`,
  );

  let inserted = 0;
  for (const lesson of LESSONS) {
    if (exists.get(lesson.slug)) continue;
    insert.run({ ...lesson, now: nowIso() });
    inserted += 1;
  }
  return inserted;
}

function seedQuizzes(db) {
  const quizExists = db.prepare('SELECT id FROM quizzes WHERE slug = ? AND version = ?');
  const insertQuiz = db.prepare(
    `INSERT INTO quizzes (slug, version, title, description, status, passing_score_percent, created_at, updated_at, published_at)
     VALUES (@slug, @version, @title, @description, @status, @passingScorePercent, @now, @now, @publishedAt)`,
  );
  const insertQuestion = db.prepare(
    `INSERT INTO quiz_questions (quiz_id, position, prompt, explanation, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertOption = db.prepare(
    'INSERT INTO quiz_options (question_id, position, label, is_correct) VALUES (?, ?, ?, ?)',
  );

  let inserted = 0;
  const seedOne = db.transaction((quiz) => {
    const now = nowIso();
    const result = insertQuiz.run({
      ...quiz,
      now,
      publishedAt: quiz.status === 'published' ? now : null,
    });
    const quizId = Number(result.lastInsertRowid);

    for (const question of quiz.questions) {
      const questionResult = insertQuestion.run(
        quizId,
        question.position,
        question.prompt,
        question.explanation || '',
        now,
      );
      const questionId = Number(questionResult.lastInsertRowid);
      for (const option of question.options) {
        insertOption.run(questionId, option.position, option.label, option.correct ? 1 : 0);
      }
    }
  });

  for (const quiz of QUIZZES) {
    if (quizExists.get(quiz.slug, quiz.version)) continue;
    seedOne(quiz);
    inserted += 1;
  }
  return inserted;
}

function main() {
  const config = loadConfig();
  const db = openDatabase(config.database.file);
  runMigrations(db);

  try {
    const lessons = seedLessons(db);
    const quizzes = seedQuizzes(db);
    console.log(`Seeded ${lessons} lesson(s) and ${quizzes} quiz version(s).`);
    console.log('Existing rows were left untouched.');
  } finally {
    db.close();
  }
}

main();
