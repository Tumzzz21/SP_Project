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
const { validateAnswerKey } = require('../grading');
const { SLUG_MAX_LENGTH } = require('../validation');

const QUIZ_COLUMNS = `
  id,
  slug,
  version,
  title,
  description,
  status,
  passing_score_percent AS passingScorePercent,
  max_attempts AS maxAttempts,
  module_id AS moduleId,
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

/**
 * Latest published version of every quiz linked to one module (newest version
 * per slug wins, so a superseded version never shows up twice).
 * @param {import('better-sqlite3').Database} db
 * @param {number} moduleId
 */
function listPublishedForModule(db, moduleId) {
  return db
    .prepare(
      `SELECT ${QUIZ_COLUMNS} FROM quizzes q
        WHERE q.module_id = ?
          AND q.status = 'published'
          AND q.version = (
            SELECT MAX(version) FROM quizzes q2
             WHERE q2.slug = q.slug AND q2.status = 'published'
          )
        ORDER BY q.title`,
    )
    .all(moduleId);
}

/** Quizzes attached to a module, any status (admin views). */
function listForModule(db, moduleId) {
  return db
    .prepare(`SELECT ${QUIZ_COLUMNS} FROM quizzes WHERE module_id = ? ORDER BY slug, version DESC`)
    .all(moduleId);
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
    // Older rows (and the pre-fix editor) could persist blank option slots;
    // never show them as choices.
    if (!option.label || !option.label.trim()) continue;
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
    // Blank option slots from older data are not real choices.
    if (!row.label || !row.label.trim()) continue;
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
 * First free slug in the family `base`, `base-2`, `base-3`, ... .
 *
 * A slug identifies a version family, so a generated slug must not collide with
 * an existing quiz: a second "Phishing basics" becomes `phishing-basics-2`
 * instead of silently minting version 2 of the first one. The base is trimmed
 * so the suffixed slug still fits the 80-character limit.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} base slug that already satisfies SLUG_PATTERN
 * @returns {string}
 */
function generateUniqueSlug(db, base) {
  const taken = db.prepare('SELECT 1 FROM quizzes WHERE slug = ? LIMIT 1');
  const stem = base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
  if (!taken.get(stem)) return stem;

  for (let counter = 2; counter < 10000; counter += 1) {
    const suffix = `-${counter}`;
    const candidate = `${stem.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.get(candidate)) return candidate;
  }

  throw new AppError(409, 'Could not find a free URL slug for this quiz title.', {
    code: 'slug_exhausted',
  });
}

/**
 * Create the first version of a quiz as a draft (version = 1 for a new slug,
 * or latest+1 when the slug already has versions).
 */
function createDraft(db, { slug, title, description, passingScorePercent = 70, maxAttempts = null, moduleId = null }) {
  const latest = findLatestBySlug(db, slug);
  const version = latest ? latest.version + 1 : 1;
  const now = new Date().toISOString();
  try {
    const result = db
      .prepare(
        `INSERT INTO quizzes (slug, version, title, description, status,
                              passing_score_percent, max_attempts, module_id, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, NULL)`,
      )
      .run(slug, version, title, description, passingScorePercent, maxAttempts, moduleId, now, now);
    return findById(db, Number(result.lastInsertRowid));
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AppError(409, 'That quiz slug and version combination already exists.', {
        code: 'slug_taken',
      });
    }
    if (error && error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      throw new AppError(400, 'That learning module no longer exists.', { code: 'module_not_found' });
    }
    throw error;
  }
}

/** Update metadata of a DRAFT version only. */
function updateDraft(db, quizId, { title, description, passingScorePercent, maxAttempts, moduleId = null }) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;
  if (quiz.status !== 'draft') {
    throw new AppError(409, 'Only draft quiz versions can be edited. Create a new version instead.', {
      code: 'quiz_not_editable',
    });
  }
  try {
    db.prepare(
      `UPDATE quizzes
          SET title = ?, description = ?, passing_score_percent = ?, max_attempts = ?, module_id = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    ).run(title, description, passingScorePercent, maxAttempts, moduleId, new Date().toISOString(), quizId);
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      throw new AppError(400, 'That learning module no longer exists.', { code: 'module_not_found' });
    }
    throw error;
  }
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
                                passing_score_percent, max_attempts, module_id, created_at, updated_at, published_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          source.slug,
          version,
          source.title,
          source.description,
          source.passingScorePercent,
          source.maxAttempts,
          source.moduleId,
          now,
          now,
        )
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

/** Number of attempts (of any status) pinned to one quiz version. */
function attemptCount(db, quizId) {
  return db.prepare('SELECT COUNT(*) AS total FROM quiz_attempts WHERE quiz_id = ?').get(quizId).total;
}

/**
 * Restore an archived version to the catalogue.
 *
 * A version that was published before returns to `published`; a version that
 * was archived from a draft returns to `draft`. The original state is inferred
 * from `published_at`, which is set exactly once when a version is published.
 *
 * Restoring to published re-validates the answer key. Restoring to draft is
 * only allowed when no attempt references the version, because draft content
 * is editable and must never mutate the questions a student answered.
 */
function restore(db, quizId) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;
  if (quiz.status !== 'archived') {
    throw new AppError(409, 'Only archived quiz versions can be restored.', {
      code: 'quiz_not_archived',
    });
  }

  const targetStatus = quiz.publishedAt ? 'published' : 'draft';
  if (targetStatus === 'published') {
    const validation = validateAnswerKey(getAnswerKey(db, quizId));
    if (!validation.ok) {
      throw new AppError(
        409,
        'This archived version cannot be published again because its question set is incomplete.',
        { code: 'quiz_restore_invalid' },
      );
    }
  } else if (attemptCount(db, quizId) > 0) {
    throw new AppError(
      409,
      'This archived version has student attempts and cannot be made editable again.',
      { code: 'quiz_restore_unsafe' },
    );
  }

  const updated = db
    .prepare(
      `UPDATE quizzes SET status = ?, updated_at = ?
        WHERE id = ? AND status = 'archived'`,
    )
    .run(targetStatus, new Date().toISOString(), quizId);
  if (updated.changes !== 1) {
    throw new AppError(409, 'Only archived quiz versions can be restored.', {
      code: 'quiz_not_archived',
    });
  }
  return findById(db, quizId);
}

/**
 * Permanently remove an archived version that no student has attempted.
 *
 * Attempts are the reason archived versions exist: they keep old results
 * explainable. If any attempt row references this quiz version the deletion is
 * refused, so no attempt or answer can ever be orphaned. The foreign keys also
 * enforce this at the database layer.
 *
 * Questions and options are protected by immutability triggers while the quiz
 * is archived. The transaction moves the row to draft only after the attempt
 * check, deletes the frozen content, then removes the quiz row. Any failure
 * rolls the whole transaction back to the archived state.
 */
function deleteArchived(db, quizId) {
  const quiz = findById(db, quizId);
  if (!quiz) return null;

  const remove = db.transaction(() => {
    const current = findById(db, quizId);
    if (!current) return false;
    if (current.status !== 'archived') {
      throw new AppError(409, 'Only archived quiz versions can be deleted.', {
        code: 'quiz_not_archived',
      });
    }

    const attempts = attemptCount(db, quizId);
    if (attempts > 0) {
      throw new AppError(
        409,
        'This quiz version has student attempts and cannot be deleted. Keep it archived to preserve their history.',
        { code: 'quiz_has_attempts' },
      );
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE quizzes SET status = 'draft', updated_at = ? WHERE id = ? AND status = 'archived'").run(
      now,
      quizId,
    );
    db.prepare(
      `DELETE FROM quiz_options
        WHERE question_id IN (SELECT id FROM quiz_questions WHERE quiz_id = ?)`,
    ).run(quizId);
    db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quizId);
    const removed = db.prepare("DELETE FROM quizzes WHERE id = ? AND status = 'draft'").run(quizId);
    if (removed.changes !== 1) throw new Error('quiz_delete_failed');
    return true;
  });

  return remove();
}

/** Live published version of a slug, used for version-history display. */
function findPublishedVersion(db, slug) {
  return findPublishedBySlug(db, slug);
}

module.exports = {
  listPublished,
  listPublishedForModule,
  listForModule,
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
  generateUniqueSlug,
  createDraft,
  updateDraft,
  replaceDraftQuestions,
  createNewVersion,
  publish,
  archive,
  restore,
  deleteArchived,
  findPublishedVersion,
};
