'use strict';

const express = require('express');

const { AppError } = require('../errors');
const { requireActive, requireStudent } = require('../auth/guards');
const lessonsDb = require('../db/lessons');

/**
 * Student-only progress actions. Reading a lesson stays open to admins, but
 * completion is tied to a student's own account.
 */
function createLessonRoutes({ db }) {
  const router = express.Router();

  router.post('/learn/:slug/complete', requireActive, requireStudent, (req, res, next) => {
    const lesson = lessonsDb.findPublishedBySlug(db, req.params.slug);
    if (!lesson) {
      return next(new AppError(404, 'That lesson is not available.', { code: 'lesson_not_found' }));
    }

    lessonsDb.markCompleted(db, req.user.id, lesson.id);
    return res.redirect(303, `/learn/${lesson.slug}?notice=lesson_completed`);
  });

  router.post('/learn/:slug/reopen', requireActive, requireStudent, (req, res, next) => {
    const lesson = lessonsDb.findPublishedBySlug(db, req.params.slug);
    if (!lesson) {
      return next(new AppError(404, 'That lesson is not available.', { code: 'lesson_not_found' }));
    }

    lessonsDb.clearProgress(db, req.user.id, lesson.id);
    return res.redirect(303, `/learn/${lesson.slug}?notice=lesson_reopened`);
  });

  return router;
}

module.exports = { createLessonRoutes };
