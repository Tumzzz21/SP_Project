'use strict';

const express = require('express');

const { AppError } = require('../errors');
const quizzesDb = require('../db/quizzes');
const { validateAnswerKey } = require('../grading');
const { readFlash } = require('../flash');
const { validateQuizInput, parseQuestionForm, parseIdParam } = require('../validation');

/**
 * Quiz authoring for admins.
 *
 * Versioning rules enforced here (and by DB triggers):
 *  - A quiz row is one immutable version. Drafts are editable; published and
 *    archived versions are frozen. Editing a published quiz means creating a
 *    new draft version that starts as a copy — old attempts keep pointing at
 *    the exact version they answered.
 *  - Publishing validates the answer key server-side first.
 *  - Student previews use getPublicQuestions (never the answer key).
 */
function createAdminQuizRoutes({ db }) {
  const router = express.Router();

  const renderForm = (req, res, statusCode, quiz, values, errors, extra = {}) =>
    res.status(statusCode).render('admin/quizzes/edit', {
      pageTitle: quiz ? `Edit quiz: ${quiz.title} | CyberSafe` : 'New quiz | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz,
      values,
      errors,
      questions: extra.questions || [],
      blocks: extra.blocks || [],
      publishError: extra.publishError || null,
      flash: [],
    });

  // ---------------------------------------------------------------- list
  router.get('/', (req, res) => {
    res.render('admin/quizzes/index', {
      pageTitle: 'Manage quizzes | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      versions: quizzesDb.listVersionsForAdmin(db),
      counts: quizzesDb.countsByStatus(db),
      flash: readFlash(req),
    });
  });

  // -------------------------------------------------------- create form
  router.get('/new', (req, res) => {
    res.render('admin/quizzes/edit', {
      pageTitle: 'New quiz | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz: null,
      values: { title: '', slug: '', description: '', passingScorePercent: 70 },
      errors: {},
      questions: [],
      blocks: [],
      publishError: null,
      flash: [],
    });
  });

  // ------------------------------------------------------------- create
  router.post('/', (req, res, next) => {
    const { values, errors } = validateQuizInput(req.body);
    if (Object.keys(errors).length > 0) {
      return renderForm(req, res, 400, null, values, errors);
    }

    // A "New quiz" with an existing slug would otherwise silently mint
    // version+1 of that family — surface it as a conflict instead.
    if (quizzesDb.findLatestBySlug(db, values.slug)) {
      return renderForm(req, res, 409, null, values, {
        ...errors,
        slug: 'That quiz slug is already in use. Edit the existing quiz or use "Create new version" on it.',
      });
    }

    try {
      const quiz = quizzesDb.createDraft(db, values);
      return res.redirect(303, `/admin/quizzes/${quiz.id}?notice=quiz_created`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'slug_taken') {
        return renderForm(req, res, 409, null, values, { ...errors, slug: error.publicMessage });
      }
      return next(error);
    }
  });

  // ---------------------------------------------------------------- edit
  router.get('/:id', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    const isDraft = quiz.status === 'draft';
    const values = {
      title: quiz.title,
      slug: quiz.slug,
      description: quiz.description || '',
      passingScorePercent: quiz.passingScorePercent,
    };

    if (!isDraft) {
      // Published/archived: read-only view, answer key visible to admins.
      return res.render('admin/quizzes/edit', {
        pageTitle: `Edit quiz: ${quiz.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'admin',
        quiz,
        values,
        errors: {},
        questions: quizzesDb.getAnswerKey(db, quiz.id),
        blocks: [],
        publishError: null,
        flash: readFlash(req),
      });
    }

    // Draft: editable metadata + question blocks (with answers, admin-only page).
    const answerKey = quizzesDb.getAnswerKey(db, quiz.id);
    const blocks = answerKey.map((question) => ({
      prompt: question.prompt,
      explanation: question.explanation,
      optionLabels: question.options.map((option) => option.label),
      correctSlot: Math.max(0, question.options.findIndex((option) => option.isCorrect)),
    }));

    return res.render('admin/quizzes/edit', {
      pageTitle: `Edit quiz: ${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz,
      values,
      errors: {},
      questions: answerKey,
      blocks,
      publishError: null,
      flash: readFlash(req),
    });
  });

  // ------------------------------------------------------- edit metadata
  router.post('/:id', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    // Slug is never editable after creation: it identifies the version family
    // that historical attempts are grouped under.
    const { values, errors } = validateQuizInput({ ...req.body, slug: quiz.slug });
    if (Object.keys(errors).length > 0) {
      return renderForm(req, res, 400, quiz, { ...values, slug: quiz.slug }, errors);
    }

    try {
      quizzesDb.updateDraft(db, quiz.id, values);
      return res.redirect(303, `/admin/quizzes/${quiz.id}?notice=quiz_updated`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'quiz_not_editable') {
        return renderForm(req, res, 409, quiz, values, {}, {
          questions: quizzesDb.getAnswerKey(db, quiz.id),
          publishError: error.publicMessage,
        });
      }
      return next(error);
    }
  });

  // -------------------------------------------------------- save questions
  router.post('/:id/questions', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    const parsed = parseQuestionForm(req.body);
    const values = {
      title: quiz.title,
      slug: quiz.slug,
      description: quiz.description || '',
      passingScorePercent: quiz.passingScorePercent,
    };

    if (parsed.errors.length > 0) {
      return res.status(400).render('admin/quizzes/edit', {
        pageTitle: `Edit quiz: ${quiz.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'admin',
        quiz,
        values,
        errors: {},
        questions: [],
        blocks: parsed.blocks,
        publishError: parsed.errors.join(' '),
        flash: [],
      });
    }

    try {
      quizzesDb.replaceDraftQuestions(db, quiz.id, parsed.questions);
      return res.redirect(303, `/admin/quizzes/${quiz.id}?notice=quiz_questions_saved`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'quiz_not_editable') {
        return res.status(409).render('admin/quizzes/edit', {
          pageTitle: `Edit quiz: ${quiz.title} | CyberSafe`,
          bodyClass: 'page-app',
          activeNav: 'admin',
          quiz,
          values,
          errors: {},
          questions: quizzesDb.getAnswerKey(db, quiz.id),
          blocks: [],
          publishError: error.publicMessage,
          flash: [],
        });
      }
      return next(error);
    }
  });

  // ------------------------------------------------------------- publish
  router.post('/:id/publish', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    const answerKey = quizzesDb.getAnswerKey(db, quiz.id);
    const validation = validateAnswerKey(answerKey);
    if (answerKey.length === 0 || !validation.ok) {
      return res.status(400).render('admin/quizzes/edit', {
        pageTitle: `Edit quiz: ${quiz.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'admin',
        quiz,
        values: {
          title: quiz.title,
          slug: quiz.slug,
          description: quiz.description || '',
          passingScorePercent: quiz.passingScorePercent,
        },
        errors: {},
        questions: answerKey,
        blocks: [],
        publishError:
          answerKey.length === 0
            ? 'Add at least one question before publishing.'
            : 'Fix the answer key before publishing: every question needs at least two options and exactly one correct answer.',
        flash: [],
      });
    }

    try {
      quizzesDb.publish(db, quiz.id);
      return res.redirect(303, `/admin/quizzes/${quiz.id}?notice=quiz_published`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'quiz_not_draft') {
        return res.redirect(303, `/admin/quizzes/${quiz.id}?error=quiz_not_editable`);
      }
      return next(error);
    }
  });

  // ------------------------------------------------------------- archive
  router.post('/:id/archive', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    quizzesDb.archive(db, quiz.id);
    return res.redirect(303, `/admin/quizzes/${quiz.id}?notice=quiz_archived`);
  });

  // --------------------------------------------------------- new version
  router.post('/:id/new-version', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    const { quiz: draft, created } = quizzesDb.createNewVersion(db, quiz.id);
    if (!created) {
      // A draft already exists for this family — send the admin there.
      return res.redirect(303, `/admin/quizzes/${draft.id}?notice=quiz_draft_exists`);
    }
    return res.redirect(303, `/admin/quizzes/${draft.id}?notice=quiz_version_created`);
  });

  // ------------------------------------------------- student-style preview
  router.get('/:id/preview', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    // Public question shape only — no correctness, no explanations.
    const questions = quizzesDb.getPublicQuestions(db, quiz.id);
    return res.render('admin/quizzes/preview', {
      pageTitle: `Preview: ${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz,
      questions,
      flash: readFlash(req),
    });
  });

  return router;
}

module.exports = { createAdminQuizRoutes };
