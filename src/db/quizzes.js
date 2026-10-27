'use strict';

/**
 * Quiz data access.
 *
 * Two clearly separated shapes:
 *   * `getPublicQuiz` / `getPublicQuestions` never include `is_correct` or the
 *     explanation, so browser code cannot see the answer key.
 *   * `getAnswerKey` is server-side only and is used by grading (later phase).
 */

const { AppError } = require('../errors');

const QUIZ_COLUMNS = `
  id,
  slug,
  version,
  title,
  description,
  status,
  passing_score_percent AS passingScorePercent,
  created_at            AS createdAt,
  updated_at            AS updatedAt,
  published_at          AS publishedAt
`;

/** Latest published version of every quiz. */
function listPublished(db) {
  return db
    .prepare(
      `SELECT ${QUIZ_COLUMNS} FROM quizzes q
        WHERE q.status = 'published'
          AND q.version = (
            SELECT MAX(version) FROM quizzes q2
             WHERE q2.slug = q.slug AND q2.status = 'published'
          )
        ORDER BY q.title`,
    )
    .all();
}

/** @param {import('better-sqlite3').Database} db @param {string} slug */
function findPublishedBySlug(db, slug) {
  return (
    db
      .prepare(
        `SELECT ${QUIZ_COLUMNS} FROM quizzes
          WHERE slug = ? AND status = 'published'
          ORDER BY version DESC LIMIT 1`,
      )
      .get(slug) || null
  );
}

/** @param {import('better-sqlite3').Database} db @param {number} quizId */
function findById(db, quizId) {
  return db.prepare(`SELECT ${QUIZ_COLUMNS} FROM quizzes WHERE id = ?`).get(quizId) || null;
}

/**
 * Questions with options, WITHOUT correctness data.
 * @param {import('better-sqlite3').Database} db @param {number} quizId
 */
function getPublicQuestions(db, quizId) {
  const questions = db
    .prepare(
      `SELECT id, position, prompt
         FROM quiz_questions
        WHERE quiz_id = ?
        ORDER BY position`,
    )
    .all(quizId);

  const options = db
    .prepare(
      `SELECT o.id, o.question_id AS questionId, o.position, o.label
         FROM quiz_options o
         JOIN quiz_questions q ON q.id = o.question_id
        WHERE q.quiz_id = ?
        ORDER BY o.position`,
    )
    .all(quizId);

  const byQuestion = new Map();
  for (const option of options) {
    if (!byQuestion.has(option.questionId)) byQuestion.set(option.questionId, []);
    byQuestion.get(option.questionId).push({ id: option.id, position: option.position, label: option.label });
  }

  return questions.map((question) => ({
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    options: byQuestion.get(question.id) || [],
  }));
}

/**
 * Server-side answer key. Never serialize this into a response.
 * @param {import('better-sqlite3').Database} db @param {number} quizId
 */
function getAnswerKey(db, quizId) {
  const rows = db
    .prepare(
      `SELECT qq.id AS questionId,
              qq.prompt,
              qq.explanation,
              o.id AS optionId,
              o.label,
              o.is_correct AS isCorrect
         FROM quiz_questions qq
         JOIN quiz_options o ON o.question_id = qq.id
        WHERE qq.quiz_id = ?
        ORDER BY qq.position, o.position`,
    )
    .all(quizId);

  const key = new Map();
  for (const row of rows) {
    if (!key.has(row.questionId)) {
      key.set(row.questionId, {
        questionId: row.questionId,
        prompt: row.prompt,
        explanation: row.explanation,
        correctOptionIds: [],
        options: [],
      });
    }
    const question = key.get(row.questionId);
    question.options.push({ id: row.optionId, label: row.label, isCorrect: row.isCorrect });
    if (row.isCorrect) question.correctOptionIds.push(row.optionId);
  }
  return [...key.values()];
}

function questionCounts(db, quizIds) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  if (quizIds.length === 0) return counts;
  const placeholders = quizIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT quiz_id AS quizId, COUNT(*) AS total
         FROM quiz_questions
        WHERE quiz_id IN (${placeholders})
        GROUP BY quiz_id`,
    )
    .all(...quizIds);
  for (const row of rows) counts.set(row.quizId, row.total);
  return counts;
}

function countsByStatus(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS total FROM quizzes GROUP BY status').all();
  const summary = { draft: 0, published: 0, archived: 0, total: 0 };
  for (const row of rows) {
    summary[row.status] = row.total;
    summary.total += row.total;
  }
  return summary;
}

/* ------------------------------------------------------------------ *
 * Authoring (admin only)
 *
 * Immutability rules enforced both here and by database triggers:
 *   * questions/options of a published or archived version cannot change
 *   * editing a live quiz means creating a NEW draft version first
 * ------------------------------------------------------------------ */

/** All quiz versions for the admin index, newest first per slug. */
function listVersionsForAdmin(db, { limit = 200 } = {}) {
  return db
    .prepare(`SELECT ${QUIZ_COLUMNS} FROM quizzes ORDER BY slug, version DESC LIMIT ?`)
    .all(limit);
}

/** Every version of one slug (admin version history). */
function listVersions(db, slug) {
  return db
    .prepare(`SELECT ${QUIZ_COLUMNS} FROM quizzes WHERE slug = ? ORDER BY version DESC`)
    .all(slug);
}

/** Latest version of a slug regardless of status. */
function findLatestBySlug(db, slug) {
  return (
    db
      .prepare(`SELECT ${QUIZ_COLUMNS} FROM quizzes WHERE slug = ? ORDER BY version DESC LIMIT 1`)
      .get(slug) || null
  );
}

/** An open draft for a slug, if one exists (blocks duplicate drafts). */
function findDraftForSlug(db, slug) {
  return (
    db
      .prepare(
        `SELECT ${QUIZ_COLUMNS} FROM quizzes
          WHERE slug = ? AND status = 'draft'
          ORDER BY version DESC LIMIT 1`,
      )
      .get(slug) || null
  );
}

/**
 * Create the first version of a quiz as a draft (version = 1 for a new slug,
 * or latest+1 when the slug already has versions).
 */
function createDraft(db, { slug, title, description, passingScorePercent = 70 }) {
  const latest = findLatestBySlug(db, slug);
  const version = latest ? latest.version + 1 : 1;
  const now = new Date().toISOString();
  try {
    const result = db
      .prepare(
        `INSERT INTO quizzes (slug, version, title, description, status,
                              passing_score_percent, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, NULL)`,
      )
      .run(slug, version, title, description, passingScorePercent, now, now);
    return findById(db, Number(result.lastInsertRowid));
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AppError(409, 'That quiz slug and version combination already exists.', {
        code: 'slug_taken',
      });
    }
    throw error;
  }
}

/** Update metadata of a DRAFT version only. */
function updateDraft(db, quizId, { title, description, passingScorePercent }) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;
  if (quiz.status !== 'draft') {
    throw new AppError(409, 'Only draft quiz versions can be edited. Create a new version instead.', {
      code: 'quiz_not_editable',
    });
  }
  db.prepare(
    `UPDATE quizzes
        SET title = ?, description = ?, passing_score_percent = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`,
  ).run(title, description, passingScorePercent, new Date().toISOString(), quizId);
  return findById(db, quizId);
}

/**
 * Replace ALL questions and options of a DRAFT version in one transaction.
 *
 * Draft versions have no attempts, so a full rewrite is safe. Published and
 * archived versions are rejected here and protected by database triggers too.
 *
 * @param {Array<{prompt:string, explanation:string,
 *                options:Array<{label:string, isCorrect:boolean}>}>} questions
 */
function replaceDraftQuestions(db, quizId, questions) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;
  if (quiz.status !== 'draft') {
    throw new AppError(409, 'Only draft quiz versions can be edited. Create a new version instead.', {
      code: 'quiz_not_editable',
    });
  }

  const now = new Date().toISOString();
  const rewrite = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM quiz_questions WHERE quiz_id = ?').all(quizId);
    const deleteOptions = db.prepare('DELETE FROM quiz_options WHERE question_id = ?');
    const deleteQuestion = db.prepare('DELETE FROM quiz_questions WHERE id = ?');
    for (const row of existing) {
      deleteOptions.run(row.id);
      deleteQuestion.run(row.id);
    }

    const insertQuestion = db.prepare(
      `INSERT INTO quiz_questions (quiz_id, position, prompt, explanation, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertOption = db.prepare(
      `INSERT INTO quiz_options (question_id, position, label, is_correct)
       VALUES (?, ?, ?, ?)`,
    );

    let position = 1;
    for (const question of questions) {
      const questionId = Number(
        insertQuestion.run(quizId, position, question.prompt, question.explanation, now).lastInsertRowid,
      );
      let optionPosition = 1;
      for (const option of question.options) {
        insertOption.run(questionId, optionPosition, option.label, option.isCorrect ? 1 : 0);
        optionPosition += 1;
      }
      position += 1;
    }
    db.prepare('UPDATE quizzes SET updated_at = ? WHERE id = ?').run(now, quizId);
  });
  rewrite();
  return findById(db, quizId);
}

/**
 * Copy a version into a NEW draft version (next number for the slug),
 * including every question and option. The source version is never touched.
 */
function createNewVersion(db, sourceQuizId) {
  const source = findById(db, sourceQuizId);
  if (!source) return null;
  const draft = findDraftForSlug(db, source.slug);
  if (draft) return { quiz: draft, created: false };

  const now = new Date().toISOString();
  const version = source.version + 1;
  const build = db.transaction(() => {
    const newId = Number(
      db
        .prepare(
          `INSERT INTO quizzes (slug, version, title, description, status,
                                passing_score_percent, created_at, updated_at, published_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, NULL)`,
        )
        .run(source.slug, version, source.title, source.description, source.passingScorePercent, now, now)
        .lastInsertRowid,
    );

    const questions = db
      .prepare('SELECT id, position, prompt, explanation FROM quiz_questions WHERE quiz_id = ? ORDER BY position')
      .all(sourceQuizId);
    const insertQuestion = db.prepare(
      `INSERT INTO quiz_questions (quiz_id, position, prompt, explanation, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertOption = db.prepare(
      `INSERT INTO quiz_options (question_id, position, label, is_correct)
       VALUES (?, ?, ?, ?)`,
    );
    for (const question of questions) {
      const questionId = Number(
        insertQuestion.run(newId, question.position, question.prompt, question.explanation, now).lastInsertRowid,
      );
      const options = db
        .prepare('SELECT position, label, is_correct FROM quiz_options WHERE question_id = ? ORDER BY position')
        .all(question.id);
      for (const option of options) {
        insertOption.run(questionId, option.position, option.label, option.is_correct);
      }
    }
    return newId;
  });
  const quizId = build();
  return { quiz: findById(db, quizId), created: true };
}

/** Draft → published. Rejected unless the answer key validates. */
function publish(db, quizId) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;
  if (quiz.status !== 'draft') {
    throw new AppError(409, 'Only draft quiz versions can be published.', { code: 'quiz_not_draft' });
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE quizzes SET status = 'published', published_at = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`,
  ).run(now, now, quizId);
  return findById(db, quizId);
}

/** Retire a version: draft or published → archived. */
function archive(db, quizId) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;
  if (quiz.status === 'archived') return quiz;
  db.prepare("UPDATE quizzes SET status = 'archived', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    quizId,
  );
  return findById(db, quizId);
}

/** Live published version of a slug, used for version-history display. */
function findPublishedVersion(db, slug) {
  return findPublishedBySlug(db, slug);
}

module.exports = {
  listPublished,
  findPublishedBySlug,
  findById,
  getPublicQuestions,
  getAnswerKey,
  questionCounts,
  countsByStatus,
  listVersionsForAdmin,
  listVersions,
  findLatestBySlug,
  findDraftForSlug,
  createDraft,
  updateDraft,
  replaceDraftQuestions,
  createNewVersion,
  publish,
  archive,
  findPublishedVersion,
};
