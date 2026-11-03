'use strict';

const express = require('express');

const { AppError } = require('../errors');
const { requireActive, requireStudent } = require('../auth/guards');
const { readFlash } = require('../flash');
const quizzesDb = require('../db/quizzes');
const attemptsDb = require('../db/attempts');
const { reviewAnswers } = require('../review');
const { percent, validateAnswerKey, parseAnswerFields, gradeAnswers } = require('../grading');

/** Lenient selection map used only to re-check radio buttons after a 400. */
function readSelections(body) {
  const selected = new Map();
  for (const [key, value] of Object.entries(body || {})) {
    const match = /^q_(\d+)$/.exec(key);
    if (!match || typeof value !== 'string' || !/^\d+$/.test(value)) continue;
    selected.set(Number(match[1]), Number(value));
  }
  return selected;
}

function parseAttemptId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createAttemptRoutes({ db }) {
  const router = express.Router();

  const studentOnly = [requireActive, requireStudent];

  /** Load an attempt the signed-in student owns; everyone else gets a 404. */
  function loadOwned(req) {
    const id = parseAttemptId(req.params.id);
    if (!id) return null;
    return attemptsDb.findOwned(db, id, req.user.id);
  }

  function renderExpired(res, attempt, quiz) {
    const latest = quizzesDb.findPublishedBySlug(db, quiz.slug);
    return res.status(409).render('attempts/expired', {
      pageTitle: `Attempt expired | ${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      attempt,
      quiz,
      retakeSlug: latest && latest.id === quiz.id ? quiz.slug : latest ? latest.slug : null,
      attemptTtlHours: attemptsDb.ATTEMPT_TTL_HOURS,
      flash: readFlash(res.req),
    });
  }

  function renderTake(res, attempt, quiz, { status = 200, formError = null, selected = new Map() } = {}) {
    const questions = quizzesDb.getPublicQuestions(db, quiz.id);
    return res.status(status).render('attempts/take-step', {
      pageTitle: `Attempt: ${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      attempt,
      quiz,
      questions,
      selected,
      formError,
      deadline: attemptsDb.expiresAt(attempt),
      flash: readFlash(res.req),
      q: 1,
      summary: false,
      missing: [],
      blank: [],
    });
  }

  // ------------------------------------------------------------ start attempt

  router.post('/quizzes/:slug/attempt', studentOnly, (req, res, next) => {
    const quiz = quizzesDb.findPublishedBySlug(db, req.params.slug);
    if (!quiz) {
      return next(new AppError(404, 'That quiz is not available.', { code: 'quiz_not_found' }));
    }

    const questions = quizzesDb.getPublicQuestions(db, quiz.id);
    if (questions.length === 0) {
      return next(
        new AppError(409, 'This quiz has no questions yet, so an attempt cannot be started.', {
          code: 'quiz_empty',
        }),
      );
    }

    const answerKey = quizzesDb.getAnswerKey(db, quiz.id);
    if (!validateAnswerKey(answerKey).ok) {
      return next(
        new AppError(409, 'This quiz is not configured correctly yet, so an attempt cannot be started.', {
          code: 'quiz_misconfigured',
        }),
      );
    }

    let open = attemptsDb.findOpen(db, req.user.id, quiz.id);
    if (open && attemptsDb.isExpired(open)) {
      attemptsDb.expire(db, open);
      open = null;
    }
    if (open) return res.redirect(303, `/attempts/${open.id}?notice=attempt_resumed`);

    let attempt;
    try {
      attempt = attemptsDb.create(db, {
        userId: req.user.id,
        quizId: quiz.id,
        maxPoints: questions.length,
      });
    } catch (error) {
      // The partial unique index is the final guard against two open
      // attempts; resume the one that won instead of failing the request.
      if (error && String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        open = attemptsDb.findOpen(db, req.user.id, quiz.id);
        if (open) return res.redirect(303, `/attempts/${open.id}?notice=attempt_resumed`);
      }
      return next(error);
    }

    return res.redirect(303, `/attempts/${attempt.id}`);
  });

  // -------------------------------------------------------- take or review

  router.get('/attempts/:id', studentOnly, (req, res, next) => {
    const attempt = loadOwned(req);
    if (!attempt) return next(new AppError(404, 'That attempt could not be found.', { code: 'attempt_not_found' }));

    const quiz = quizzesDb.findById(db, attempt.quizId);
    if (!quiz) return next(new AppError(404, 'That attempt could not be found.', { code: 'attempt_not_found' }));

    if (attempt.status === 'expired') return renderExpired(res, attempt, quiz);

    if (attempt.status === 'in_progress' && attemptsDb.isExpired(attempt)) {
      const expired = attemptsDb.expire(db, attempt);
      return renderExpired(res, expired, quiz);
    }

    if (attempt.status === 'submitted') {
      const answers = reviewAnswers(db, quiz.id, attemptsDb.answersForReview(db, attempt.id));
      return res.render('attempts/result', {
        pageTitle: `Result: ${quiz.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'quizzes',
        attempt,
        quiz,
        answers,
        correctCount: answers.filter((a) => a.isCorrect === 1).length,
        unansweredCount: answers.filter((a) => a.selectedOptionId === null).length,
        percentage: percent(attempt.scorePoints, attempt.maxPoints),
        latestPublished: quizzesDb.findPublishedBySlug(db, quiz.slug),
        flash: readFlash(req),
        csrfToken: res.locals.csrfToken,
        canRetry: (() => {
          const max = quiz.maxAttempts;
          if (!max) return true;
          const c = db.prepare('SELECT COUNT(*) AS c FROM quiz_attempts WHERE user_id = ? AND quiz_id = ? AND status = ?').get(req.user.id, quiz.id, 'submitted').c;
          return c < max;
        })(),
      });
    }

    const questions = quizzesDb.getPublicQuestions(db, quiz.id);
    const saved = new Map(attemptsDb.savedAnswers(db, attempt.id).map((a) => [a.questionId, a.selectedOptionId]));
    const q = Math.max(1, Math.min(questions.length, Number(req.query.q) || 1));
    const summary = req.query.q === 'summary';
    return res.render('attempts/take-step', {
      pageTitle: `Attempt: ${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'quizzes',
      attempt,
      quiz,
      questions,
      selected: saved,
      formError: null,
      deadline: attemptsDb.expiresAt(attempt),
      flash: readFlash(req),
      q,
      summary,
      missing: req.query.missing ? String(req.query.missing).split(',').map(Number) : [],
      blank: req.query.blank ? String(req.query.blank).split(',').map(Number) : [],
    });
  });

  // ----------------------------------------------------------- save one answer
  router.post('/attempts/:id/answer', [requireActive], (req, res, next) => {
    const attempt = loadOwned(req);
    if (!attempt) return res.status(404).json({ ok: false, message: 'That attempt could not be found.' });
    if (attempt.status !== 'in_progress') {
      return res.status(409).json({ ok: false, message: 'This attempt is no longer open.' });
    }
    if (attemptsDb.isExpired(attempt)) {
      attemptsDb.expire(db, attempt);
      return res.status(409).json({ ok: false, message: 'This attempt has expired.' });
    }
    const quiz = quizzesDb.findById(db, attempt.quizId);
    if (!quiz) return res.status(404).json({ ok: false, message: 'That attempt could not be found.' });

    const questionId = Number(req.body && req.body.questionId);
    const rawOption = req.body && req.body.selectedOptionId;
    const selectedOptionId = rawOption === null ? null : Number(rawOption);

    const questions = quizzesDb.getPublicQuestions(db, attempt.quizId);
    const question = questions.find((q) => q.id === questionId);
    if (!question) return res.status(400).json({ ok: false, message: 'That question is not part of this quiz.' });
    if (selectedOptionId !== null) {
      const validOption = question.options.some((o) => o.id === selectedOptionId);
      if (!validOption) return res.status(400).json({ ok: false, message: 'That answer is not a valid option.' });
    }

    const ok = attemptsDb.saveAnswer(db, { attemptId: attempt.id, userId: req.user.id, questionId, selectedOptionId });
    if (!ok) return res.status(409).json({ ok: false, message: 'This attempt is no longer open.' });
    const answered = attemptsDb.savedAnswers(db, attempt.id).filter((a) => a.selectedOptionId != null).length;
    return res.json({ ok: true, answered });
  });

  // ----------------------------------------------------------- blank check
  router.get('/attempts/:id/blanks', [requireActive], (req, res) => {
    const attempt = loadOwned(req);
    if (!attempt) return res.status(404).json({ ok: false, blanks: [] });
    const questions = quizzesDb.getPublicQuestions(db, attempt.quizId);
    const saved = new Map(attemptsDb.savedAnswers(db, attempt.id).map((a) => [a.questionId, a.selectedOptionId]));
    const blanks = questions.filter((q) => saved.get(q.id) == null).map((q) => q.position);
    return res.json({ ok: true, blanks });
  });

  // ---------------------------------------------------------------- submit
  router.post('/attempts/:id/submit', studentOnly, (req, res, next) => {
    const attempt = loadOwned(req);
    if (!attempt) return next(new AppError(404, 'That attempt could not be found.', { code: 'attempt_not_found' }));

    const quiz = quizzesDb.findById(db, attempt.quizId);
    if (!quiz) return next(new AppError(404, 'That attempt could not be found.', { code: 'attempt_not_found' }));

    // A repeated submit never overwrites the saved record.
    if (attempt.status === 'submitted') {
      return res.redirect(303, `/attempts/${attempt.id}?notice=already_submitted`);
    }

    if (attempt.status === 'expired' || attemptsDb.isExpired(attempt)) {
      if (attempt.status === 'in_progress') attemptsDb.expire(db, attempt);
      return res.redirect(303, `/attempts/${attempt.id}?notice=attempt_expired`);
    }

    const questions = quizzesDb.getPublicQuestions(db, attempt.quizId);
    const bodyAnswers = parseAnswerFields(req.body);
    for (const qid of bodyAnswers.keys()) {
      if (!questions.some((q) => q.id === qid)) {
        return next(new AppError(400, 'That quiz submission did not match this quiz.', { code: 'unknown_question' }));
      }
    }
    for (const [qid, optId] of bodyAnswers.entries()) {
      const q = questions.find((x) => x.id === qid);
      if (optId !== null && q && !q.options.some((o) => o.id === optId)) {
        return next(new AppError(400, 'One of the selected answers is not a valid option for this question.', { code: 'invalid_option' }));
      }
    }
    const savedMap = bodyAnswers.size > 0 ? bodyAnswers : new Map(attemptsDb.savedAnswers(db, attempt.id).map((a) => [a.questionId, a.selectedOptionId]));
    const missing = questions.filter((q) => !savedMap.has(q.id) || savedMap.get(q.id) == null).map((q) => q.position);
    if (missing.length > 0) {
      return res.redirect(303, `/attempts/${attempt.id}?missing=${missing.join(',')}`);
    }
    const answerKey = quizzesDb.getAnswerKey(db, attempt.quizId);
    if (!validateAnswerKey(answerKey).ok) {
      return next(
        new AppError(409, 'This quiz cannot be graded because its questions are not configured correctly.', {
          code: 'quiz_misconfigured',
        }),
      );
    }

    let answers;
    let graded;
    try {
      answers = parseAnswerFields(req.body);
      if (answers.size === 0) {
        const saved = attemptsDb.savedAnswers(db, attempt.id);
        for (const a of saved) answers.set(a.questionId, a.selectedOptionId);
      }
      graded = gradeAnswers(answerKey, answers);
    } catch (error) {
      if (error instanceof AppError) {
        return renderTake(res, attempt, quiz, {
          status: error.statusCode,
          formError: error.message,
          selected: readSelections(req.body),
        });
      }
      return next(error);
    }

    const finalized = attemptsDb.finalize(db, {
      attemptId: attempt.id,
      userId: req.user.id,
      scorePoints: graded.scorePoints,
      maxPoints: graded.maxPoints,
      results: graded.results,
    });

    if (!finalized) {
      return res.redirect(303, `/attempts/${attempt.id}?notice=already_submitted`);
    }
    return res.redirect(303, `/attempts/${attempt.id}?notice=attempt_submitted`);
  });

  return router;
}

module.exports = { createAttemptRoutes };
