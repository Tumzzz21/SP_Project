'use strict';

const express = require('express');

const { AppError } = require('../errors');
const quizzesDb = require('../db/quizzes');
const modulesDb = require('../db/modules');
const { validateAnswerKey } = require('../grading');
const attemptsDb = require('../db/attempts');
const { readFlash } = require('../flash');
const { validateQuizInput, parseQuestionForm, parseIdParam, slugify, safeReturnPath, withNotice } = require('../validation');

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

  // Modules a quiz can be attached to (any status: drafts may be authored
  // before their module is published).
  const moduleOptions = () => modulesDb.listForAdmin(db);
  const moduleIds = () => moduleOptions().map((mod) => mod.id);

  const renderForm = (req, res, statusCode, quiz, values, errors, extra = {}) =>
    res.status(statusCode).render('admin/quizzes/edit', {
      pageTitle: quiz ? `Edit quiz: ${quiz.title} | CyberSafe` : 'New quiz | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz,
      values,
      errors,
      modules: moduleOptions(),
      questions: extra.questions || [],
      blocks: extra.blocks || [],
      publishError: extra.publishError || null,
      flash: [],
    });

  // ---------------------------------------------------------------- list
  router.get('/', (req, res) => {
    return res.redirect(303, '/admin/attempts');
  });

  // -------------------------------------------------------- create form
  router.get('/new', (req, res) => {
    res.render('admin/quizzes/edit', {
      pageTitle: 'New quiz | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz: null,
      values: { title: '', description: '', passingScorePercent: 70, maxAttempts: '', moduleId: null },
      errors: {},
      modules: moduleOptions(),
      questions: [],
      blocks: [],
      publishError: null,
      flash: [],
    });
  });

  // ------------------------------------------------------------- create
  router.post('/', (req, res, next) => {
    const { values, errors } = validateQuizInput(req.body, { moduleIds: moduleIds() });
    if (Object.keys(errors).length > 0) {
      return renderForm(req, res, 400, null, values, errors);
    }

    // The slug is never typed by an admin: it is derived from the title and
    // de-duplicated here, so creating "Phishing basics" twice yields the
    // distinct families `phishing-basics` and `phishing-basics-2` rather than
    // silently minting version 2 of the first quiz.
    try {
      const slug = quizzesDb.generateUniqueSlug(db, slugify(values.title));
      const quiz = quizzesDb.createDraft(db, { ...values, slug });
      return res.redirect(303, `/admin/quizzes/${quiz.id}?notice=quiz_created`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'slug_taken') {
        return renderForm(req, res, 409, null, values, {
          ...errors,
          title: 'A quiz with that title was just created. Try a slightly different title.',
        });
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
      description: quiz.description || '',
      passingScorePercent: quiz.passingScorePercent,
      maxAttempts: quiz.maxAttempts === null ? '' : quiz.maxAttempts,
      moduleId: quiz.moduleId,
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
        modules: moduleOptions(),
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
      modules: moduleOptions(),
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
    const { values, errors } = validateQuizInput(req.body, { moduleIds: moduleIds() });
    if (Object.keys(errors).length > 0) {
      return renderForm(req, res, 400, quiz, values, errors);
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
      description: quiz.description || '',
      passingScorePercent: quiz.passingScorePercent,
      maxAttempts: quiz.maxAttempts === null ? '' : quiz.maxAttempts,
      moduleId: quiz.moduleId,
    };

    if (parsed.errors.length > 0) {
      return res.status(400).render('admin/quizzes/edit', {
        pageTitle: `Edit quiz: ${quiz.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'admin',
        quiz,
        values,
        errors: {},
        modules: moduleOptions(),
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
          modules: moduleOptions(),
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
          description: quiz.description || '',
          passingScorePercent: quiz.passingScorePercent,
          maxAttempts: quiz.maxAttempts === null ? '' : quiz.maxAttempts,
          moduleId: quiz.moduleId,
        },
        errors: {},
        modules: moduleOptions(),
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
      const returnTo = safeReturnPath(req.body.returnTo, `/admin/quizzes/${quiz.id}`);
      return res.redirect(303, withNotice(returnTo, 'quiz_published'));
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
    // Catalogue cards send their own URL back, so a list-level action does not
    // dump the admin on the now read-only version page. The detail page sends
    // nothing and keeps its in-place behaviour.
    const returnTo = safeReturnPath(req.body.returnTo, `/admin/quizzes/${quiz.id}`);
    return res.redirect(303, withNotice(returnTo, 'quiz_archived'));
  });

  // ------------------------------------------------------------- restore
  router.post('/:id/restore', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    try {
      quizzesDb.restore(db, quiz.id);
      const returnTo = safeReturnPath(req.body.returnTo, '/quizzes');
      return res.redirect(303, withNotice(returnTo, 'quiz_restored'));
    } catch (error) {
      if (
        error instanceof AppError &&
        ['quiz_not_archived', 'quiz_restore_invalid', 'quiz_restore_unsafe'].includes(error.code)
      ) {
        return res.redirect(303, `/quizzes?error=${error.code}`);
      }
      return next(error);
    }
  });

  // -------------------------------------------------------------- delete
  router.post('/:id/delete', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const quiz = id ? quizzesDb.findById(db, id) : null;
    if (!quiz) return next(new AppError(404, 'That quiz version was not found.', { code: 'quiz_not_found' }));

    try {
      quizzesDb.deleteArchived(db, quiz.id);
      const returnTo = safeReturnPath(req.body.returnTo, '/quizzes');
      return res.redirect(303, withNotice(returnTo, 'quiz_deleted'));
    } catch (error) {
      if (error instanceof AppError && ['quiz_not_archived', 'quiz_has_attempts'].includes(error.code)) {
        return res.redirect(303, `/quizzes?error=${error.code}`);
      }
      return next(error);
    }
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

  router.get('/:id/submissions', (req, res, next) => {
    const id = Number(req.params.id);
    const quiz = quizzesDb.findById(db, id);
    if (!quiz) return next(new (require('../errors').AppError)(404, 'Quiz not found.', { code: 'not_found' }));
    const submissions = attemptsDb.listForQuiz(db, id);
    res.render('admin/quizzes/submissions', {
      pageTitle: `Submissions: ${quiz.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'admin',
      quiz,
      submissions,
      flash: readFlash(req),
    });
  });

  return router;
}

module.exports = { createAdminQuizRoutes };
