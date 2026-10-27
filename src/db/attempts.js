'use strict';

/**
 * Quiz attempts and submitted answers.
 *
 * `quiz_attempts.quiz_id` points at one immutable quiz version, which is how a
 * historical attempt keeps the exact questions it was graded against after a
 * newer version is published.
 */

const ATTEMPT_COLUMNS = `
  id,
  user_id      AS userId,
  quiz_id      AS quizId,
  status,
  score_points AS scorePoints,
  max_points   AS maxPoints,
  started_at   AS startedAt,
  submitted_at AS submittedAt
`;

/** In-progress attempts older than this are treated as expired. */
const ATTEMPT_TTL_HOURS = 24;

function nowIso() {
  return new Date().toISOString();
}

function findById(db, attemptId) {
  return db.prepare(`SELECT ${ATTEMPT_COLUMNS} FROM quiz_attempts WHERE id = ?`).get(attemptId) || null;
}

/**
 * Fetch an attempt only when it belongs to the given student.
 * Returning null for another student's attempt keeps ownership private.
 */
function findOwned(db, attemptId, userId) {
  return (
    db
      .prepare(`SELECT ${ATTEMPT_COLUMNS} FROM quiz_attempts WHERE id = ? AND user_id = ?`)
      .get(attemptId, userId) || null
  );
}

function findOpen(db, userId, quizId) {
  return (
    db
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM quiz_attempts
          WHERE user_id = ? AND quiz_id = ? AND status = 'in_progress'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(userId, quizId) || null
  );
}

/**
 * Create an attempt pinned to `quizId`. The partial unique index on open
 * attempts means a double submit cannot create two rows; the caller resumes
 * the existing attempt instead.
 */
function create(db, { userId, quizId, maxPoints }) {
  const startedAt = nowIso();
  const result = db
    .prepare(
      `INSERT INTO quiz_attempts (user_id, quiz_id, status, score_points, max_points, started_at)
       VALUES (?, ?, 'in_progress', 0, ?, ?)`,
    )
    .run(userId, quizId, maxPoints, startedAt);
  return findById(db, Number(result.lastInsertRowid));
}

function isExpired(attempt, now = Date.now()) {
  if (attempt.status !== 'in_progress') return false;
  const started = new Date(attempt.startedAt).getTime();
  if (Number.isNaN(started)) return true;
  return now - started >= ATTEMPT_TTL_HOURS * 60 * 60 * 1000;
}

function expiresAt(attempt) {
  return new Date(new Date(attempt.startedAt).getTime() + ATTEMPT_TTL_HOURS * 60 * 60 * 1000);
}

/** Move a stale in-progress attempt to `expired`; returns the fresh row. */
function expire(db, attempt) {
  db.prepare("UPDATE quiz_attempts SET status = 'expired' WHERE id = ? AND status = 'in_progress'").run(
    attempt.id,
  );
  return findById(db, attempt.id);
}

/**
 * Every attempt that produced a record: submitted or expired.
 * In-progress attempts stay out of history until they are finished.
 */
function listForUser(db, userId) {
  return db
    .prepare(
      `SELECT a.id,
              a.user_id      AS userId,
              a.quiz_id      AS quizId,
              a.status,
              a.score_points AS scorePoints,
              a.max_points   AS maxPoints,
              a.started_at   AS startedAt,
              a.submitted_at AS submittedAt,
              q.slug,
              q.title,
              q.version,
              q.status       AS quizStatus
         FROM quiz_attempts a
         JOIN quizzes q ON q.id = a.quiz_id
        WHERE a.user_id = ? AND a.status IN ('submitted', 'expired')
        ORDER BY COALESCE(a.submitted_at, a.started_at) DESC, a.id DESC`,
    )
    .all(userId);
}

/** Count of submitted attempts for one quiz version. */
function statsForQuiz(db, userId, quizId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              MAX(CASE WHEN status = 'submitted' THEN score_points * 1.0 / NULLIF(max_points, 0) END) AS bestRatio,
              MAX(CASE WHEN status = 'submitted' THEN submitted_at END) AS lastSubmittedAt
         FROM quiz_attempts
        WHERE user_id = ? AND quiz_id = ?`,
    )
    .get(userId, quizId);
  return {
    total: row.total,
    bestRatio: row.bestRatio === null ? null : Number(row.bestRatio),
    lastSubmittedAt: row.lastSubmittedAt || null,
  };
}

/**
 * Graded answers for review, including the correct label and explanation.
 * Only called after an attempt is submitted, for its owner.
 */
function answersForReview(db, attemptId) {
  return db
    .prepare(
      `SELECT aq.question_id          AS questionId,
              qq.position,
              qq.prompt,
              qq.explanation,
              aq.selected_option_id   AS selectedOptionId,
              so.label                AS selectedLabel,
              aq.is_correct           AS isCorrect,
              (SELECT label FROM quiz_options
                WHERE question_id = qq.id AND is_correct = 1
                ORDER BY position LIMIT 1) AS correctLabel
         FROM attempt_answers aq
         JOIN quiz_questions qq ON qq.id = aq.question_id
         LEFT JOIN quiz_options so ON so.id = aq.selected_option_id
        WHERE aq.attempt_id = ?
        ORDER BY qq.position`,
    )
    .all(attemptId);
}

/**
 * Admin view: recent attempts across all students, read-only.
 * Includes the student identity and the exact quiz version used.
 */
function listRecentForAdmin(db, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT a.id,
              a.user_id      AS userId,
              a.quiz_id      AS quizId,
              a.status,
              a.score_points AS scorePoints,
              a.max_points   AS maxPoints,
              a.started_at   AS startedAt,
              a.submitted_at AS submittedAt,
              q.slug,
              q.title,
              q.version,
              u.display_name AS studentName,
              u.username     AS studentUsername,
              u.email        AS studentEmail
         FROM quiz_attempts a
         JOIN quizzes q ON q.id = a.quiz_id
         JOIN users   u ON u.id = a.user_id
        WHERE a.status IN ('submitted', 'expired')
        ORDER BY COALESCE(a.submitted_at, a.started_at) DESC, a.id DESC
        LIMIT ?`,
    )
    .all(limit);
}

/**
 * Admin view: one attempt with student and quiz-version context.
 * Returns null when the attempt does not exist. No ownership check — callers
 * must sit behind requireAdmin.
 */
function findForAdmin(db, attemptId) {
  return (
    db
      .prepare(
        `SELECT a.id,
                a.user_id      AS userId,
                a.quiz_id      AS quizId,
                a.status,
                a.score_points AS scorePoints,
                a.max_points   AS maxPoints,
                a.started_at   AS startedAt,
                a.submitted_at AS submittedAt,
                q.slug,
                q.title,
                q.version,
                q.passing_score_percent AS passingScorePercent,
                u.display_name AS studentName,
                u.username     AS studentUsername,
                u.email        AS studentEmail
           FROM quiz_attempts a
           JOIN quizzes q ON q.id = a.quiz_id
           JOIN users   u ON u.id = a.user_id
          WHERE a.id = ?`,
      )
      .get(attemptId) || null
  );
}

/**
 * Participation summary for the admin dashboard.
 * Average score = mean of each submitted attempt's percentage, rounded.
 */
function participationSummary(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS submittedAttempts,
              COUNT(DISTINCT user_id) AS participants,
              AVG(CASE WHEN max_points > 0 THEN score_points * 100.0 / max_points END) AS averagePercent
         FROM quiz_attempts
        WHERE status = 'submitted'`,
    )
    .get();
  return {
    submittedAttempts: row.submittedAttempts,
    participants: row.participants,
    averagePercent: row.averagePercent === null ? null : Math.round(Number(row.averagePercent)),
  };
}

/**
 * Finalise an attempt and store each graded answer atomically.
 *
 * The conditional UPDATE is the duplicate-submit guard: if the attempt is no
 * longer `in_progress` (or belongs to someone else) it changes zero rows and
 * nothing is inserted. Answers are inserted before the status change so the
 * "no answers on submitted attempts" trigger never blocks a legitimate save.
 *
 * @returns {boolean} true when this call finalised the attempt
 */
function finalize(db, { attemptId, userId, scorePoints, maxPoints, results }) {
  const save = db.transaction(() => {
    const state = db
      .prepare('SELECT status FROM quiz_attempts WHERE id = ? AND user_id = ?')
      .get(attemptId, userId);
    if (!state || state.status !== 'in_progress') return false;

    const insert = db.prepare(
      `INSERT INTO attempt_answers (attempt_id, question_id, selected_option_id, is_correct, answered_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const answeredAt = nowIso();
    for (const result of results) {
      insert.run(attemptId, result.questionId, result.selectedOptionId, result.isCorrect, answeredAt);
    }

    const update = db
      .prepare(
        `UPDATE quiz_attempts
            SET status = 'submitted', score_points = ?, max_points = ?, submitted_at = ?
          WHERE id = ? AND user_id = ? AND status = 'in_progress'`,
      )
      .run(scorePoints, maxPoints, answeredAt, attemptId, userId);

    if (update.changes === 0) {
      // Throwing rolls the transaction back, including the answer inserts.
      throw new Error('attempt_not_open');
    }
    return true;
  });

  try {
    return save();
  } catch (error) {
    if (error && error.message === 'attempt_not_open') return false;
    throw error;
  }
}

module.exports = {
  ATTEMPT_TTL_HOURS,
  findById,
  findOwned,
  findOpen,
  create,
  isExpired,
  expiresAt,
  expire,
  listForUser,
  statsForQuiz,
  answersForReview,
  listRecentForAdmin,
  findForAdmin,
  participationSummary,
  finalize,
};
