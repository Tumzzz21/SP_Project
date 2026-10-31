'use strict';

const express = require('express');
const { requireActive, requireAdmin } = require('../auth/guards');
const users = require('../db/users');
const modulesDb = require('../db/modules');
const quizzesDb = require('../db/quizzes');
const attemptsDb = require('../db/attempts');
const history = require('../history');
const { readFlash } = require('../flash');
const { createAdminQuizRoutes } = require('./admin-quizzes');
const { createAdminAttemptRoutes } = require('./admin-attempts');
const { createAdminModuleRoutes } = require('./admin-modules');
const { createAdminStudentsRoutes } = require('./admin-students');
const { createAdminUsersRoutes } = require('./admin-users');

/**
 * Admin area. Every route below sits behind requireActive + requireAdmin.
 */
function createAdminRoutes({ db }) {
  const router = express.Router();
  const guard = [requireActive, requireAdmin];

  const sections = [
    ['/admin/quizzes', 'quizzes'],
    ['/admin/modules', 'modules'],
    ['/admin/students', 'students'],
    ['/admin/users', 'users'],
    ['/admin/attempts', 'attempts'],
  ];
  router.use((req, res, next) => {
    if (!req.path.startsWith('/admin')) return next();
    const match = sections.find(([prefix]) => req.path === prefix || req.path.startsWith(`${prefix}/`));
    res.locals.adminTab = match ? match[1] : 'overview';
    next();
  });

  router.get('/admin', ...guard, (req, res) => {
    const moduleCounts = modulesDb.countsByStatus(db);
    const quizCounts = quizzesDb.countsByStatus(db);
    const draftModules = modulesDb.listForAdmin(db).filter((m) => m.status === 'draft');
    const draftQuizzes = quizzesDb.listVersionsForAdmin(db).filter((q) => q.status === 'draft');
    const studentsNotStarted = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.email FROM users u
         WHERE u.role = 'student' AND u.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM module_item_progress p JOIN module_items i ON i.id = p.item_id JOIN modules m ON m.id = i.module_id WHERE p.user_id = u.id AND m.status = 'published')`,
      )
      .all();
    // Admin's own learning progress
    const adminModules = modulesDb.listPublished(db).map((m) => ({
      ...m,
      progress: modulesDb.progressForModule(db, req.user.id, m.id),
    }));
    const adminCompletedModules = adminModules.filter((m) => m.progress.total > 0 && m.progress.completed === m.progress.total).length;
    const adminTotalItems = adminModules.reduce((a, m) => a + m.progress.total, 0);
    const adminCompletedItems = adminModules.reduce((a, m) => a + m.progress.completed, 0);
    const adminOverallPercent = adminTotalItems > 0 ? Math.round((adminCompletedItems / adminTotalItems) * 100) : 0;
    const adminHistory = history.decorateHistory(attemptsDb.listForUser(db, req.user.id));
    const adminHistorySummary = history.summarizeHistory(adminHistory);
    res.render('admin/index', {
      pageTitle: 'Admin | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      userCounts: users.countsByRole(db),
      studentCounts: users.studentStatusCounts(db),
      moduleCounts,
      quizCounts,
      participation: attemptsDb.participationSummary(db),
      recentAttempts: attemptsDb.listRecentForAdmin(db, { limit: 6 }),
      draftModules,
      draftQuizzes,
      studentsNotStarted,
      adminProgress: {
        completedModules: adminCompletedModules,
        totalModules: adminModules.length,
        overallPercent: adminOverallPercent,
        bestPercentage: adminHistorySummary.bestPercentage,
      },
      flash: readFlash(req),
    });
  });

  router.use('/admin/quizzes', ...guard, createAdminQuizRoutes({ db }));
  router.use('/admin/attempts', ...guard, createAdminAttemptRoutes({ db }));
  router.use('/admin/modules', ...guard, createAdminModuleRoutes({ db }));
  router.use('/admin', createAdminStudentsRoutes({ db }));
  router.use('/admin', createAdminUsersRoutes({ db }));

  return router;
}

module.exports = { createAdminRoutes };
