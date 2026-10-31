'use strict';

const express = require('express');

const { AppError } = require('../errors');
const { requireActive, requireStudent, requireGuest, safeNextPath } = require('../auth/guards');
const { readFlash } = require('../flash');
const users = require('../db/users');
const lessonsDb = require('../db/lessons');
const modulesDb = require('../db/modules');
const quizzesDb = require('../db/quizzes');
const attemptsDb = require('../db/attempts');
const sessionsDb = require('../db/sessions');
const { validateSetupInput, validateDisplayName, validateChoice } = require('../validation');
const { CATEGORIES, CATEGORY_KEYS, categoryByKey } = require('../content/categories');
const { renderLessonContent } = require('../content/render');
const { validateAnswerKey } = require('../grading');
const { decorateHistory, summarizeHistory } = require('../history');

function createPageRoutes({ db, config }) {
  const router = express.Router();

  // ---------------------------------------------------------------- public

  router.get('/', (req, res) => {
    if (req.user) return res.redirect(303, '/dashboard');
    return res.redirect(303, '/login');
  });

  router.get('/login', requireGuest, (req, res) => {
    res.render('login', {
      pageTitle: 'Sign in | CyberSafe',
      bodyClass: 'page-auth',
      next: safeNextPath(String(req.query.next || ''), ''),
      flash: readFlash(req),
      devAuth: config.devAuth,
      googleConfigured: config.google.configured,
      values: { email: '' },
      errors: {},
      adminMode: false,
    });
  });

  router.get('/admin-login', requireGuest, (req, res) => {
    res.render('login', {
      pageTitle: 'Administrator sign in | CyberSafe',
      bodyClass: 'page-auth',
      next: safeNextPath(String(req.query.next || ''), '/admin'),
      flash: readFlash(req),
      devAuth: config.devAuth,
      googleConfigured: config.google.configured,
      values: { email: '' },
      errors: {},
      adminMode: true,
    });
  });

  router.get('/register', requireGuest, (req, res) => {
    res.render('register', {
      pageTitle: 'Create your account | CyberSafe',
      bodyClass: 'page-auth',
      flash: readFlash(req),
      errors: {},
      values: { email: '' },
      googleConfigured: config.google.configured,
    });
  });

  router.get('/forgot-password', requireGuest, (req, res) => {
    res.render('forgot-password', {
      pageTitle: 'Reset your password | CyberSafe',
      bodyClass: 'page-auth',
      flash: readFlash(req),
      errors: {},
      values: { email: '' },
    });
  });

  // ------------------------------------------------------- first-time setup

  router.get('/setup', (req, res) => {
    if (!req.user) return res.redirect(302, '/login');
    if (req.user.status === 'pending_setup') {
      return res.render('setup', {
        pageTitle: 'Set up your account | CyberSafe',
        bodyClass: 'page-auth',
        flash: readFlash(req),
        values: { username: '', displayName: '' },
        errors: {},
      });
    }
    return res.redirect(302, req.user.role === 'admin' ? '/admin' : '/dashboard');
  });

  router.post('/setup', (req, res, next) => {
    if (!req.user) return res.redirect(302, '/login');
    if (req.user.status !== 'pending_setup') {
      return res.redirect(302, req.user.role === 'admin' ? '/admin' : '/dashboard');
    }

    const { values, errors } = validateSetupInput(req.body);
    if (Object.keys(errors).length > 0) {
      return res.status(400).render('setup', {
        pageTitle: 'Set up your account | CyberSafe',
        bodyClass: 'page-auth',
        flash: [],
        values,
        errors,
      });
    }

    try {
      users.completeSetup(db, req.user.id, values);
    } catch (error) {
      if (error instanceof AppError && error.code === 'username_taken') {
        return res.status(409).render('setup', {
          pageTitle: 'Set up your account | CyberSafe',
          bodyClass: 'page-auth',
          flash: [],
          values,
          errors: { username: 'That username is already taken. Try another one.' },
        });
      }
      return next(error);
    }

    return res.redirect(303, '/dashboard?notice=setup_complete');
  });

  // ------------------------------------------------------------- dashboard

  router.get('/dashboard', requireActive, (req, res) => {

    const progress = lessonsDb.progressByLesson(db, req.user.id);
    const published = lessonsDb.listPublished(db);
    const summary = lessonsDb.progressSummary(db, req.user.id);
    const nextLesson = lessonsDb.nextIncomplete(db, req.user.id);
    const history = decorateHistory(attemptsDb.listForUser(db, req.user.id));
    const categories = CATEGORIES.map((category) => ({
      ...category,
      lessons: published.filter((lesson) => lesson.category === category.key).length,
    }));

    res.render('dashboard', {
      pageTitle: 'Your dashboard | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'dashboard',
      summary,
      categories,
      progress,
      lessons: published,
      nextLesson,
      recentAttempts: history.slice(0, 4),
      historySummary: summarizeHistory(history),
      flash: readFlash(req),
    });
  });

  // --------------------------------------------------------- learning center

  router.get('/learn', requireActive, (req, res) => {
    return res.redirect(303, '/modules');
  });

  router.get('/learn/:slug', requireActive, (req, res, next) => {
    const lesson = lessonsDb.findPublishedBySlug(db, req.params.slug);
    if (!lesson) {
      return next(new AppError(404, 'That lesson is not available.', { code: 'lesson_not_found' }));
    }
    // Redirect to the module containing this lesson.
    const mod = db.prepare("SELECT m.id FROM modules m JOIN module_items mi ON mi.module_id = m.id WHERE mi.title = ? AND m.status = 'published'").get(lesson.title);
    if (mod) {
      return res.redirect(303, '/modules/' + mod.id);
    }
    // Fallback: redirect to modules list
    return res.redirect(303, '/modules');
  });

  // ---------------------------------------------------------------- quizzes

  router.get('/quizzes', requireActive, (req, res) => {
    const quizzes = req.user.role === 'admin'
      ? quizzesDb.listVersionsForAdmin(db)
      : quizzesDb.listPublished(db);
    const counts = quizzesDb.questionCounts(db, quizzes.map((quiz) => quiz.id));
    const adminView = req.user.role === 'admin';

    let cards = quizzes;
    if (!adminView) {
      const history = decorateHistory(attemptsDb.listForUser(db, req.user.id));
      cards = quizzes.map((quiz) => {
        const open = attemptsDb.findOpen(db, req.user.id, quiz.id);
        const usableOpen = open && !attemptsDb.isExpired(open) ? open : null;
        const stats = attemptsDb.statsForQuiz(db, req.user.id, quiz.id);
        return {
          ...quiz,
          questionCount: counts.get(quiz.id) || 0,
          attempts: stats.total,
          bestPercentage:
            stats.bestRatio === null ? null : Math.round(stats.bestRatio * 100),
          openAttemptId: usableOpen ? usableOpen.id : null,
          attemptHistory: history.filter((attempt) => attempt.slug === quiz.slug).slice(0, 1),
        };
      });
    }

    res.render('quizzes/index', {
      pageTitle: 'Quizzes | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      quizzes: cards,
      counts,
      adminView,
      user: req.user,
      flash: readFlash(req),
    });
  });

  router.get('/quizzes/history', requireActive, requireStudent, (req, res) => {
    const history = decorateHistory(attemptsDb.listForUser(db, req.user.id));

    res.render('quizzes/history', {
      pageTitle: 'Your quiz history | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      history,
      summary: summarizeHistory(history),
      flash: readFlash(req),
    });
  });

  router.get('/quizzes/:slug', requireActive, (req, res, next) => {
    const quiz = quizzesDb.findPublishedBySlug(db, req.params.slug);
    if (!quiz) return next(new AppError(404, 'That quiz is not available.', { code: 'quiz_not_found' }));

    const questions = quizzesDb.getPublicQuestions(db, quiz.id);
    const adminView = req.user.role === 'admin';

    if (adminView) {
      return res.render('quizzes/show', {
        pageTitle: `${quiz.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'quizzes',
        quiz,
        questions,
        adminView: true,
      });
    }

    const answerKey = quizzesDb.getAnswerKey(db, quiz.id);
    const availability =
      questions.length === 0
        ? 'empty'
        : validateAnswerKey(answerKey).ok
          ? 'ready'
          : 'misconfigured';

    const open = attemptsDb.findOpen(db, req.user.id, quiz.id);
    const openAttempt = open && !attemptsDb.isExpired(open) ? open : null;
    const stats = attemptsDb.statsForQuiz(db, req.user.id, quiz.id);
    const history = decorateHistory(attemptsDb.listForUser(db, req.user.id)).filter(
      (attempt) => attempt.quizId === quiz.id,
    );

    return res.render('quizzes/show', {
      pageTitle: `${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      quiz,
      questions,
      adminView: false,
      availability,
      openAttempt,
      stats,
      bestPercentage: stats.bestRatio === null ? null : Math.round(stats.bestRatio * 100),
      attempts: history,
      flash: readFlash(req),
    });
  });

  // ---------------------------------------------------------------- account

  router.get('/account', requireActive, (req, res) => {
    return res.redirect(303, '/settings/profile');
  });
  return router;
}

module.exports = { createPageRoutes };
