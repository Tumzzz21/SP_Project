'use strict';

const express = require('express');
const { requireActive, requireAdmin } = require('../auth/guards');
const users = require('../db/users');
const lessonsDb = require('../db/lessons');
const quizzesDb = require('../db/quizzes');
const attemptsDb = require('../db/attempts');
const { readFlash } = require('../flash');
const { createAdminLessonRoutes } = require('./admin-lessons');
const { createAdminQuizRoutes } = require('./admin-quizzes');
const { createAdminAttemptRoutes } = require('./admin-attempts');

/**
 * Admin area. Every route below sits behind requireActive + requireAdmin —
 * there is no public path into any of this, and no registration endpoint.
 */
function createAdminRoutes({ db }) {
  const router = express.Router();
  const guard = [requireActive, requireAdmin];

  router.get('/admin', ...guard, (req, res) => {
    res.render('admin/index', {
      pageTitle: 'Admin | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      userCounts: users.countsByRole(db),
      studentCounts: users.studentStatusCounts(db),
      lessonCounts: lessonsDb.countsByStatus(db),
      quizCounts: quizzesDb.countsByStatus(db),
      participation: attemptsDb.participationSummary(db),
      recentAttempts: attemptsDb.listRecentForAdmin(db, { limit: 6 }),
      recentUsers: users.listUsers(db, { limit: 8 }),
      lessons: lessonsDb.listForAdmin(db, { limit: 8 }),
      quizzes: quizzesDb.listPublished(db),
      flash: readFlash(req),
    });
  });

  // Content management + review, all admin-only.
  router.use('/admin/lessons', ...guard, createAdminLessonRoutes({ db }));
  router.use('/admin/quizzes', ...guard, createAdminQuizRoutes({ db }));
  router.use('/admin/attempts', ...guard, createAdminAttemptRoutes({ db }));

  return router;
}

module.exports = { createAdminRoutes };
