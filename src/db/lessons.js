'use strict';

const { AppError } = require('../errors');

const LESSON_COLUMNS = `
  id,
  slug,
  title,
  summary,
  category,
  content,
  reading_minutes AS readingMinutes,
  status,
  created_at      AS createdAt,
  updated_at      AS updatedAt,
  published_at    AS publishedAt
`;

/** @param {import('better-sqlite3').Database} db */
function listPublished(db, { category = null } = {}) {
  if (category) {
    return db
      .prepare(
        `SELECT ${LESSON_COLUMNS} FROM lessons
          WHERE status = 'published' AND category = ?
          ORDER BY category, title`,
      )
      .all(category);
  }
  return db
    .prepare(
      `SELECT ${LESSON_COLUMNS} FROM lessons
        WHERE status = 'published'
        ORDER BY category, title`,
    )
    .all();
}

/** @param {import('better-sqlite3').Database} db @param {string} slug */
function findPublishedBySlug(db, slug) {
  return (
    db
      .prepare(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE slug = ? AND status = 'published'`)
      .get(slug) || null
  );
}

/** Admin view: every lesson regardless of publication state. */
function listForAdmin(db, { limit = 100 } = {}) {
  return db
    .prepare(`SELECT ${LESSON_COLUMNS} FROM lessons ORDER BY updated_at DESC LIMIT ?`)
    .all(limit);
}

/** Any lesson regardless of status (admin screens). */
function findById(db, lessonId) {
  return db.prepare(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = ?`).get(lessonId) || null;
}

/** Admin list with optional text search and status filter. */
function listForAdminFiltered(db, { search = '', status = null, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  const term = String(search || '').trim().toLowerCase();
  if (term) {
    clauses.push('(LOWER(title) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(summary) LIKE ?)');
    const like = `%${term}%`;
    params.push(like, like, like);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  return db
    .prepare(
      `SELECT ${LESSON_COLUMNS} FROM lessons ${where}
        ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...params);
}

/** Create a lesson as a draft. Throws AppError 409 on a duplicate slug. */
function create(db, { slug, title, summary, category, content, readingMinutes }) {
  const now = new Date().toISOString();
  try {
    const result = db
      .prepare(
        `INSERT INTO lessons (slug, title, summary, category, content, reading_minutes,
                              status, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
      )
      .run(slug, title, summary, category, content, readingMinutes, now, now);
    return findById(db, Number(result.lastInsertRowid));
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AppError(409, 'That lesson slug is already in use.', { code: 'slug_taken' });
    }
    throw error;
  }
}

/** Update lesson fields. Throws AppError 409 on a slug used by another lesson. */
function update(db, lessonId, { slug, title, summary, category, content, readingMinutes }) {
  const now = new Date().toISOString();
  try {
    const result = db
      .prepare(
        `UPDATE lessons
            SET slug = ?, title = ?, summary = ?, category = ?, content = ?,
                reading_minutes = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(slug, title, summary, category, content, readingMinutes, now, lessonId);
    if (result.changes === 0) return null;
    return findById(db, lessonId);
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AppError(409, 'That lesson slug is already in use.', { code: 'slug_taken' });
    }
    throw error;
  }
}

/**
 * Transition a lesson between draft, published, and archived.
 * Progress rows are untouched: students keep their history for archived lessons.
 * @returns {object|null} updated lesson, or null when the id does not exist
 */
function setStatus(db, lessonId, status) {
  const now = new Date().toISOString();
  const existing = findById(db, lessonId);
  if (!existing) return null;
  const publishedAt = status === 'published' ? existing.publishedAt || now : existing.publishedAt;
  db.prepare('UPDATE lessons SET status = ?, published_at = ?, updated_at = ? WHERE id = ?').run(
    status,
    publishedAt,
    now,
    lessonId,
  );
  return findById(db, lessonId);
}

function countsByStatus(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS total FROM lessons GROUP BY status').all();
  const summary = { draft: 0, published: 0, archived: 0, total: 0 };
  for (const row of rows) {
    summary[row.status] = row.total;
    summary.total += row.total;
  }
  return summary;
}

/**
 * Progress for one student, keyed by lesson id.
 * @returns {Map<number, {state:string, completedAt:string|null}>}
 */
function progressByLesson(db, userId) {
  const rows = db
    .prepare('SELECT lesson_id AS lessonId, state, completed_at AS completedAt FROM lesson_progress WHERE user_id = ?')
    .all(userId);
  return new Map(rows.map((row) => [row.lessonId, { state: row.state, completedAt: row.completedAt }]));
}

function progressSummary(db, userId) {
  const published = db.prepare("SELECT COUNT(*) AS total FROM lessons WHERE status = 'published'").get().total;
  const completed = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM lesson_progress p
         JOIN lessons l ON l.id = p.lesson_id
        WHERE p.user_id = ? AND p.state = 'completed' AND l.status = 'published'`,
    )
    .get(userId).total;
  return {
    publishedLessons: published,
    completedLessons: completed,
    remainingLessons: Math.max(published - completed, 0),
    percentComplete: published === 0 ? 0 : Math.round((completed / published) * 100),
  };
}

/**
 * Mark a published lesson complete for one student.
 * Repeated requests are no-ops: the first completion timestamp is kept.
 * @returns {boolean} true when a new completion row was created
 */
function markCompleted(db, userId, lessonId) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO lesson_progress (user_id, lesson_id, state, started_at, completed_at, updated_at)
       VALUES (?, ?, 'completed', ?, ?, ?)
       ON CONFLICT (user_id, lesson_id) DO NOTHING`,
    )
    .run(userId, lessonId, now, now, now);
  if (result.changes > 0) return true;

  // A row may exist as in_progress (for example after an undo); completing it
  // updates that row instead of inserting a duplicate.
  const update = db
    .prepare(
      `UPDATE lesson_progress
          SET state = 'completed', completed_at = ?, updated_at = ?
        WHERE user_id = ? AND lesson_id = ? AND state <> 'completed'`,
    )
    .run(now, now, userId, lessonId);
  return update.changes > 0;
}

/** Undo completion by removing the student's progress row for the lesson. */
function clearProgress(db, userId, lessonId) {
  const result = db
    .prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .run(userId, lessonId);
  return result.changes > 0;
}

/** First published lesson the student has not completed, in Learning Center order. */
function nextIncomplete(db, userId) {
  return (
    db
      .prepare(
        `SELECT ${LESSON_COLUMNS} FROM lessons l
          WHERE l.status = 'published'
            AND NOT EXISTS (
              SELECT 1 FROM lesson_progress p
               WHERE p.lesson_id = l.id AND p.user_id = ? AND p.state = 'completed'
            )
          ORDER BY l.category, l.title
          LIMIT 1`,
      )
      .get(userId) || null
  );
}

module.exports = {
  listPublished,
  findPublishedBySlug,
  listForAdmin,
  listForAdminFiltered,
  findById,
  create,
  update,
  setStatus,
  countsByStatus,
  progressByLesson,
  progressSummary,
  markCompleted,
  clearProgress,
  nextIncomplete,
};
