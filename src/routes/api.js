'use strict';

const express = require('express');

const { AppError } = require('../errors');
const { requireSession, requireActive, requireAdmin, wantsJson } = require('../auth/guards');
const users = require('../db/users');
const lessonsDb = require('../db/lessons');
const quizzesDb = require('../db/quizzes');

/** Public shape of an account. Google subject identifiers stay server-side. */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function publicLesson(lesson) {
  return {
    id: lesson.id,
    slug: lesson.slug,
    title: lesson.title,
    summary: lesson.summary,
    category: lesson.category,
    readingMinutes: lesson.readingMinutes,
    publishedAt: lesson.publishedAt,
  };
}

function createApiRoutes({ db }) {
  const router = express.Router();

  router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'cybersafe', time: new Date().toISOString() });
  });

  router.get('/api/me', requireSession, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  router.get('/api/lessons', requireActive, (req, res) => {
    const lessons = lessonsDb.listPublished(db);
    res.json({ lessons: lessons.map(publicLesson) });
  });

  router.get('/api/lessons/:slug', requireActive, (req, res, next) => {
    const lesson = lessonsDb.findPublishedBySlug(db, req.params.slug);
    if (!lesson) {
      return next(new AppError(404, 'That lesson is not available.', { code: 'lesson_not_found' }));
    }
    return res.json({
      lesson: {
        ...publicLesson(lesson),
        content: lesson.content,
      },
    });
  });

  /**
   * Quiz payloads intentionally contain no `is_correct` flag and no
   * explanation: the answer key never leaves the server before submission.
   */
  router.get('/api/quizzes', requireActive, (req, res) => {
    const quizzes = quizzesDb.listPublished(db);
    const counts = quizzesDb.questionCounts(db, quizzes.map((quiz) => quiz.id));
    res.json({
      quizzes: quizzes.map((quiz) => ({
        slug: quiz.slug,
        title: quiz.title,
        description: quiz.description,
        version: quiz.version,
        questionCount: counts.get(quiz.id) || 0,
      })),
    });
  });

  router.get('/api/quizzes/:slug', requireActive, (req, res, next) => {
    const quiz = quizzesDb.findPublishedBySlug(db, req.params.slug);
    if (!quiz) {
      return next(new AppError(404, 'That quiz is not available.', { code: 'quiz_not_found' }));
    }
    const questions = quizzesDb.getPublicQuestions(db, quiz.id);
    return res.json({
      quiz: {
        slug: quiz.slug,
        title: quiz.title,
        description: quiz.description,
        version: quiz.version,
        questions: questions.map((question) => ({
          id: question.id,
          position: question.position,
          prompt: question.prompt,
          options: question.options.map((option) => ({
            id: option.id,
            position: option.position,
            label: option.label,
          })),
        })),
      },
    });
  });

  router.get('/api/admin/summary', requireActive, requireAdmin, (req, res) => {
    res.json({
      users: users.countsByRole(db),
      lessons: lessonsDb.countsByStatus(db),
      quizzes: quizzesDb.countsByStatus(db),
    });
  });

  return router;
}

module.exports = { createApiRoutes, publicUser, publicLesson, wantsJson };
