'use strict';

const express = require('express');

const { AppError } = require('../errors');
const lessonsDb = require('../db/lessons');
const { CATEGORIES, CATEGORY_KEYS } = require('../content/categories');
const { renderLessonContent } = require('../content/render');
const { readFlash } = require('../flash');
const { validateChoice, validateLessonInput, parseIdParam } = require('../validation');

const STATUS_VALUES = ['draft', 'published', 'archived'];

function statusFlash(status, previousStatus) {
  if (status === 'published') return 'lesson_published';
  if (status === 'archived') return 'lesson_archived';
  // Back to draft: distinguish unpublishing from restoring an archive.
  return previousStatus === 'published' ? 'lesson_unpublished' : 'content_saved';
}

/**
 * Lesson authoring for admins: create, edit, publish, unpublish, archive.
 *
 * There is no hard delete anywhere here — lesson_progress references lessons
 * by id, so archiving keeps every student's history intact.
 */
function createAdminLessonRoutes({ db }) {
  const router = express.Router();

  // ---------------------------------------------------------------- list
  router.get('/', (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q : '';
    const status = validateChoice(req.query.status, STATUS_VALUES);
    const lessons = lessonsDb.listForAdminFiltered(db, { search, status });

    res.render('admin/lessons/index', {
      pageTitle: 'Manage lessons | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      lessons,
      counts: lessonsDb.countsByStatus(db),
      search,
      status,
      flash: readFlash(req),
    });
  });

  // -------------------------------------------------------- create form
  router.get('/new', (req, res) => {
    res.render('admin/lessons/form', {
      pageTitle: 'New lesson | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      lesson: null,
      values: { title: '', slug: '', summary: '', category: '', content: '', readingMinutes: 4 },
      errors: {},
      categories: CATEGORIES,
      flash: [],
    });
  });

  // ------------------------------------------------------------- create
  router.post('/', (req, res, next) => {
    const { values, errors } = validateLessonInput(req.body, { categoryKeys: CATEGORY_KEYS });
    if (Object.keys(errors).length > 0) {
      return res.status(400).render('admin/lessons/form', {
        pageTitle: 'New lesson | CyberSafe',
        bodyClass: 'page-app',
        activeNav: 'admin',
        lesson: null,
        values,
        errors,
        categories: CATEGORIES,
        flash: [],
      });
    }

    try {
      const lesson = lessonsDb.create(db, values);
      return res.redirect(303, `/admin/lessons/${lesson.id}?notice=lesson_saved`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'slug_taken') {
        return res.status(409).render('admin/lessons/form', {
          pageTitle: 'New lesson | CyberSafe',
          bodyClass: 'page-app',
          activeNav: 'admin',
          lesson: null,
          values,
          errors: { ...errors, slug: error.publicMessage },
          categories: CATEGORIES,
          flash: [],
        });
      }
      return next(error);
    }
  });

  // ---------------------------------------------------------- edit form
  router.get('/:id', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const lesson = id ? lessonsDb.findById(db, id) : null;
    if (!lesson) return next(new AppError(404, 'That lesson was not found.', { code: 'lesson_not_found' }));

    return res.render('admin/lessons/form', {
      pageTitle: `Edit ${lesson.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'admin',
      lesson,
      values: {
        title: lesson.title,
        slug: lesson.slug,
        summary: lesson.summary,
        category: lesson.category,
        content: lesson.content,
        readingMinutes: lesson.readingMinutes,
      },
      errors: {},
      categories: CATEGORIES,
      flash: readFlash(req),
    });
  });

  // ------------------------------------------------------------- update
  router.post('/:id', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const lesson = id ? lessonsDb.findById(db, id) : null;
    if (!lesson) return next(new AppError(404, 'That lesson was not found.', { code: 'lesson_not_found' }));

    const { values, errors } = validateLessonInput(req.body, { categoryKeys: CATEGORY_KEYS });
    const renderForm = (statusCode) =>
      res.status(statusCode).render('admin/lessons/form', {
        pageTitle: `Edit ${lesson.title} | CyberSafe`,
        bodyClass: 'page-app',
        activeNav: 'admin',
        lesson,
        values,
        errors,
        categories: CATEGORIES,
        flash: [],
      });

    if (Object.keys(errors).length > 0) return renderForm(400);

    try {
      lessonsDb.update(db, lesson.id, values);
      return res.redirect(303, `/admin/lessons/${lesson.id}?notice=lesson_updated`);
    } catch (error) {
      if (error instanceof AppError && error.code === 'slug_taken') {
        return renderForm(409);
      }
      return next(error);
    }
  });

  // ------------------------------------------------------ status change
  router.post('/:id/status', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const lesson = id ? lessonsDb.findById(db, id) : null;
    if (!lesson) return next(new AppError(404, 'That lesson was not found.', { code: 'lesson_not_found' }));

    const status = validateChoice(req.body.status, STATUS_VALUES);
    if (!status) return next(new AppError(400, 'Choose a valid lesson status.', { code: 'invalid_status' }));

    const updated = lessonsDb.setStatus(db, lesson.id, status);
    if (!updated) return next(new AppError(404, 'That lesson was not found.', { code: 'lesson_not_found' }));

    const notice = status === lesson.status ? 'content_saved' : statusFlash(status, lesson.status);
    return res.redirect(303, `/admin/lessons/${lesson.id}?notice=${notice}`);
  });

  // ------------------------------------------------------------ preview
  router.get('/:id/preview', (req, res, next) => {
    const id = parseIdParam(req.params.id);
    const lesson = id ? lessonsDb.findById(db, id) : null;
    if (!lesson) return next(new AppError(404, 'That lesson was not found.', { code: 'lesson_not_found' }));

    return res.render('admin/lessons/preview', {
      pageTitle: `Preview: ${lesson.title} | CyberSafe`,
      bodyClass: 'page-app',
      activeNav: 'admin',
      lesson,
      bodyHtml: renderLessonContent(lesson.content),
      flash: readFlash(req),
    });
  });

  return router;
}

module.exports = { createAdminLessonRoutes };
