'use strict';

const express = require('express');

const { AppError } = require('../errors');
const attemptsDb = require('../db/attempts');
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

  // --------------------------------------------------------------- list
  router.get('/', (req, res) => {
    const attempts = attemptsDb.listRecentForAdmin(db, { limit: 50 });
    res.render('admin/attempts/index', {
      pageTitle: 'Attempt review | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      attempts,
      flash: readFlash(req),
    });
  });

  // ------------------------------------------------------------- detail
  router.get('/:id', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const attempt = id ? attemptsDb.findForAdmin(db, id) : null;
    if (!attempt) return next(new AppError(404, 'That attempt was not found.', { code: 'attempt_not_found' }));

    const answers = attempt.status === 'submitted' ? attemptsDb.answersForReview(db, attempt.id) : [];
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

  return router;
}

module.exports = { createAdminAttemptRoutes };
