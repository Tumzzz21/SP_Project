'use strict';

/**
 * Shared "question review" shaping used by the student result page and the
 * admin attempt review. Both pages render the same partial, so a student and
 * an instructor see exactly the same answer breakdown.
 */

const quizzesDb = require('./db/quizzes');

/**
 * Attach the question's options and the correct option id to each graded
 * answer row produced by `attemptsDb.answersForReview`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} quizId pinned quiz version the attempt belongs to
 * @param {Array<object>} answers rows from answersForReview
 * @returns {Array<object>} answers plus `options` and `correctOptionId`
 */
function reviewAnswers(db, quizId, answers) {
  const questions = quizzesDb.getPublicQuestions(db, quizId);
  const byId = new Map(questions.map((question) => [question.id, question]));

  return answers.map((answer) => {
    const question = byId.get(answer.questionId) || {};
    const options = question.options || [];
    const correct = options.find((option) => option.position === answer.correctPosition) || null;
    return {
      ...answer,
      options,
      correctOptionId: correct ? correct.id : null,
    };
  });
}

module.exports = { reviewAnswers };
