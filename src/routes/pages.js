'use strict';

const express = require('express');

const { AppError } = require('../errors');
const { requireActive, requireStudent, requireGuest, safeNextPath, googleSignInAvailable } = require('../auth/guards');
const { readFlash } = require('../flash');
const users = require('../db/users');
const modulesDb = require('../db/modules');
const quizzesDb = require('../db/quizzes');
const attemptsDb = require('../db/attempts');
const sessionsDb = require('../db/sessions');
const { validateSetupInput, validateDisplayName, validateChoice } = require('../validation');
const { CATEGORIES, CATEGORY_KEYS, categoryByKey } = require('../content/categories');
const { SAFETY_TIPS } = require('../content/safety-tips');
const { renderLessonContent } = require('../content/render');
const { validateAnswerKey } = require('../grading');
const { decorateHistory, summarizeHistory } = require('../history');

/** Map a quiz slug/title onto the shared topic icon set. */
function quizTopicIcon(quiz) {
  const haystack = `${quiz.slug || ''} ${quiz.title || ''}`.toLowerCase();
  if (haystack.includes('phish')) return 'phishing';
  if (haystack.includes('password') || haystack.includes('passphrase')) return 'passwords';
  if (haystack.includes('scam')) return 'scams';
  if (haystack.includes('privacy') || haystack.includes('data')) return 'privacy';
  if (haystack.includes('ethic') || haystack.includes('responsible')) return 'ethics';
  return 'quizzes';
}

function quizCard(quiz, counts) {
  return {
    ...quiz,
    topicIcon: quizTopicIcon(quiz),
    questionCount: counts.get(quiz.id) || 0,
  };
}

function createPageRoutes({ db, config }) {
  const router = express.Router();

  // ---------------------------------------------------------------- public

  router.get('/', (req, res) => {
    if (req.user) return res.redirect(303, '/dashboard');
    return res.redirect(303, '/login');
  });

  // Public on purpose: linked from the sign-in screen and from the nav for
  // everyone, and safe to share with people who have no account.
  router.get('/safety-tips', (req, res) => {
    res.render('safety-tips', {
      pageTitle: 'Safety tips | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'safety',
      tips: SAFETY_TIPS,
      flash: readFlash(req),
    });
  });

  router.get('/login', requireGuest, (req, res) => {
    res.render('login', {
      pageTitle: 'Sign in | CyberSafe',
      bodyClass: 'page-auth',
      next: safeNextPath(String(req.query.next || ''), ''),
      flash: readFlash(req),
      devAuth: config.devAuth,
      googleConfigured: googleSignInAvailable(req, config),
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
      googleConfigured: googleSignInAvailable(req, config),
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
      googleConfigured: googleSignInAvailable(req, config),
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
    const mods = modulesDb.listPublished(db);
    const modulesWithProgress = mods.map((m) => ({
      ...m,
      progress: modulesDb.progressForModule(db, req.user.id, m.id),
    }));
    // Next unfinished module item
    let nextItem = null;
    let nextModule = null;
    for (const m of modulesWithProgress) {
      const items = modulesDb.moduleProgress(db, req.user.id, m.id);
      const firstIncomplete = items.find((it) => !it.completed);
      if (firstIncomplete) {
        nextItem = firstIncomplete;
        nextModule = m;
        break;
      }
    }
    const completedModules = modulesWithProgress.filter((m) => m.progress.total > 0 && m.progress.completed === m.progress.total).length;
    const totalItems = modulesWithProgress.reduce((a, m) => a + m.progress.total, 0);
    const completedItems = modulesWithProgress.reduce((a, m) => a + m.progress.completed, 0);
    const overallPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    const history = decorateHistory(attemptsDb.listForUser(db, req.user.id));
    const historySummary = summarizeHistory(history);

    res.render('dashboard', {
      pageTitle: 'Your dashboard | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'dashboard',
      user: req.user,
      modules: modulesWithProgress,
      nextItem,
      nextModule,
      completedModules,
      overallPercent,
      totalItems,
      completedItems,
      recentAttempts: history.slice(0, 4),
      historySummary,
      flash: readFlash(req),
    });
  });

  // --------------------------------------------------------- learning center

  router.get('/learn', requireActive, (req, res) => {
    return res.redirect(303, '/modules');
  });

  router.get('/learn/:slug', requireActive, (req, res) => {
    return res.redirect(303, '/modules');
  });

  // ---------------------------------------------------------------- quizzes

  router.get('/quizzes', requireActive, (req, res) => {
    const adminView = req.user.role === 'admin';
    const versions = adminView
      ? quizzesDb.listVersionsForAdmin(db)
      : quizzesDb.listPublished(db);
    const counts = quizzesDb.questionCounts(db, versions.map((quiz) => quiz.id));

    let cards = [];
    let archivedQuizzes = [];

    if (adminView) {
      // The catalogue shows one card per live version family: the latest
      // published version plus any open draft. Everything archived is moved
      // to the collapsed archive section at the bottom of the page.
      const bySlug = new Map();
      for (const quiz of versions) {
        if (!bySlug.has(quiz.slug)) bySlug.set(quiz.slug, []);
        bySlug.get(quiz.slug).push(quiz);
      }
      for (const family of bySlug.values()) {
        const latestPublished = family.find((quiz) => quiz.status === 'published');
        const latestDraft = family.find((quiz) => quiz.status === 'draft');
        if (latestPublished) cards.push(quizCard(latestPublished, counts));
        if (latestDraft) cards.push(quizCard(latestDraft, counts));
        for (const quiz of family) {
          if (quiz.status === 'archived') archivedQuizzes.push(quizCard(quiz, counts));
        }
      }
      const byTitle = (a, b) => a.title.localeCompare(b.title) || b.version - a.version;
      cards.sort(byTitle);
      archivedQuizzes.sort(byTitle);
    } else {
      cards = versions.map((quiz) => {
        const open = attemptsDb.findOpen(db, req.user.id, quiz.id);
        const usableOpen = open && !attemptsDb.isExpired(open) ? open : null;
        const stats = attemptsDb.statsForQuiz(db, req.user.id, quiz.id);
        return {
          ...quizCard(quiz, counts),
          attempts: stats.total,
          completedAttempts: stats.completed,
          bestPercentage:
            stats.bestRatio === null ? null : Math.round(stats.bestRatio * 100),
          bestScorePoints: stats.bestScorePoints,
          bestMaxPoints: stats.bestMaxPoints,
          openAttemptId: usableOpen ? usableOpen.id : null,
        };
      });
    }

    // Admin filters are also honoured server-side so a link (and the redirect
    // after archiving) can land directly on the requested view; the chips then
    // take over instantly in the browser.
    const requestedFilter = String(req.query.filter || 'all');
    const activeFilter =
      adminView && ['all', 'published', 'draft', 'archived'].includes(requestedFilter) ? requestedFilter : 'all';

    res.render('quizzes/index', {
      pageTitle: 'Quizzes | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      quizzes: cards,
      archivedQuizzes,
      counts,
      adminView,
      activeFilter,
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
