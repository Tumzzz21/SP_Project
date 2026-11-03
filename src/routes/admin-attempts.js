'use strict';

const express = require('express');

const { AppError } = require('../errors');
const attemptsDb = require('../db/attempts');
const { reviewAnswers } = require('../review');
const { readFlash } = require('../flash');
const { parseIdParam } = require('../validation');

/**
 * Read-only attempt review for admins.
 *
 * Deliberately contains NO write endpoints: scores are produced only by the
 * student submission flow, and submitted attempts are immutable at the
 * database level (migration triggers). This router only ever renders.
 */
function createAdminAttemptRoutes({ db }) {
  const router = express.Router();

  // --------------------------------------------------------------- list (quiz-centric)
  router.get('/', (req, res) => {
    const quizzesDb = require('../db/quizzes');
    const quizzes = quizzesDb.listVersionsForAdmin(db, { limit: 200 });
    // aggregate to latest per slug
    const seen = new Set();
    const unique = [];
    for (const q of quizzes) {
      if (seen.has(q.slug)) continue;
      seen.add(q.slug);
      unique.push(q);
    }
    const list = unique.map((q) => {
      const rows = db.prepare('SELECT score_points, max_points, user_id FROM quiz_attempts WHERE quiz_id = ? AND status = \'submitted\'').all(q.id);
      const total = rows.length;
      const avg = total ? Math.round(rows.reduce((s, r) => s + (r.max_points > 0 ? (r.score_points * 100) / r.max_points : 0), 0) / total) : 0;
      const students = new Set(rows.map((r) => r.user_id)).size;
      return { ...q, totalSubmissions: total, avgScore: avg, uniqueStudents: students };
    });
    res.render('admin/attempts/index', {
      pageTitle: 'Attempt review | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      quizzes: list,
      flash: readFlash(req),
    });
  });

  // ------------------------------------------------------------- detail
  router.get('/:id', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const attempt = id ? attemptsDb.findForAdmin(db, id) : null;
    if (!attempt) return next(new AppError(404, 'That attempt was not found.', { code: 'attempt_not_found' }));

    const answers =
      attempt.status === 'submitted'
        ? reviewAnswers(db, attempt.quizId, attemptsDb.answersForReview(db, attempt.id))
        : [];
    const percentage =
      attempt.maxPoints > 0
        ? Math.round((attempt.scorePoints * 100) / attempt.maxPoints)
        : null;

    return res.render('admin/attempts/show', {
      pageTitle: `Attempt #${attempt.id} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'admin',
      attempt,
      answers,
      percentage,
      flash: readFlash(req),
    });
  });

  // ------------------------------------------------------------- feedback
  router.post('/:id/feedback', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const attempt = id ? attemptsDb.findForAdmin(db, id) : null;
    if (!attempt) return next(new AppError(404, 'That attempt was not found.', { code: 'attempt_not_found' }));
    const feedback = String(req.body.feedback || '').trim();
    const publish = req.body.publish === '1';
    const now = new Date().toISOString();
    db.prepare('UPDATE quiz_attempts SET admin_feedback = ?, feedback_published_at = ? WHERE id = ?').run(feedback, publish ? now : null, id);
    return res.redirect(303, '/admin/attempts/' + id + '?notice=feedback_saved');
  });

  return router;
}

module.exports = { createAdminAttemptRoutes };
