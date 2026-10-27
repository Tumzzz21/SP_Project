'use strict';

/**
 * Quiz grading.
 *
 * Everything here runs on the server only. The browser receives question and
 * option ids, never the answer key, and any score it could invent is ignored:
 * the score is derived from the pinned quiz version stored in the database.
 *
 * Rules (deliberately simple and consistent):
 *   * one point per question, awarded only for the single correct option;
 *   * an unanswered question scores zero and is stored with a NULL selection;
 *   * percentage is a whole number: round(score / max * 100);
 *   * a quiz with zero questions, or a single-choice question with zero or
 *     several correct options, is refused rather than graded inconsistently.
 */

const { AppError } = require('./errors');

function percent(scorePoints, maxPoints) {
  if (!Number.isFinite(scorePoints) || !Number.isFinite(maxPoints)) return 0;
  if (maxPoints <= 0) return 0;
  const value = Math.round((scorePoints / maxPoints) * 100);
  return Math.min(Math.max(value, 0), 100);
}

/**
 * Check the stored answer key before an attempt starts or is graded.
 * @param {Array<{questionId:number, options:Array<{id:number, isCorrect:boolean|number}>}>} answerKey
 * @returns {{ok:boolean, reason:string|null}}
 */
function validateAnswerKey(answerKey) {
  if (!Array.isArray(answerKey) || answerKey.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  for (const question of answerKey) {
    const options = Array.isArray(question.options) ? question.options : [];
    const correct = options.filter((option) => Boolean(option.isCorrect)).length;
    if (options.length < 2 || correct !== 1) {
      return { ok: false, reason: 'invalid' };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Read `q_<questionId>=<optionId>` fields from an HTML form.
 * Unknown field names are ignored so the CSRF field and other form chrome do
 * not break, but a malformed answer value is a hard 400.
 *
 * @param {Record<string, unknown>} body
 * @returns {Map<number, number>} questionId -> selected optionId
 */
function parseAnswerFields(body) {
  const answers = new Map();
  for (const [key, value] of Object.entries(body || {})) {
    const match = /^q_(\d+)$/.exec(key);
    if (!match) continue;

    const questionId = Number(match[1]);
    if (!Number.isSafeInteger(questionId) || questionId <= 0) {
      throw new AppError(400, 'That quiz submission contained an invalid question.', {
        code: 'invalid_question',
      });
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
      throw new AppError(400, 'That quiz submission contained an invalid answer.', {
        code: 'invalid_answer',
      });
    }
    const optionId = Number(value.trim());
    if (!Number.isSafeInteger(optionId) || optionId <= 0) {
      throw new AppError(400, 'That quiz submission contained an invalid answer.', {
        code: 'invalid_answer',
      });
    }
    answers.set(questionId, optionId);
  }
  return answers;
}

/**
 * Grade a submission against the pinned answer key.
 *
 * @param {Array<{questionId:number, explanation:string, options:Array<{id:number, isCorrect:boolean|number}>}>} answerKey
 * @param {Map<number, number>} answers questionId -> optionId
 * @returns {{
 *   maxPoints:number,
 *   scorePoints:number,
 *   percentage:number,
 *   results:Array<{questionId:number, selectedOptionId:number|null, isCorrect:number}>
 * }}
 */
function gradeAnswers(answerKey, answers) {
  const validity = validateAnswerKey(answerKey);
  if (!validity.ok) {
    throw new AppError(409, 'This quiz cannot be graded because its questions are not configured correctly.', {
      code: 'quiz_misconfigured',
    });
  }

  const byQuestion = new Map(answerKey.map((question) => [question.questionId, question]));
  for (const questionId of answers.keys()) {
    if (!byQuestion.has(questionId)) {
      throw new AppError(400, 'That quiz submission did not match this quiz.', {
        code: 'unknown_question',
      });
    }
  }

  const results = [];
  let scorePoints = 0;

  for (const question of answerKey) {
    const selectedOptionId = answers.has(question.questionId) ? answers.get(question.questionId) : null;
    let isCorrect = 0;

    if (selectedOptionId !== null) {
      const option = question.options.find((candidate) => candidate.id === selectedOptionId);
      if (!option) {
        throw new AppError(400, 'One of the selected answers is not a valid option for this question.', {
          code: 'invalid_option',
        });
      }
      isCorrect = option.isCorrect ? 1 : 0;
      if (isCorrect === 1) scorePoints += 1;
    }

    results.push({ questionId: question.questionId, selectedOptionId, isCorrect });
  }

  return {
    maxPoints: answerKey.length,
    scorePoints,
    percentage: percent(scorePoints, answerKey.length),
    results,
  };
}

module.exports = {
  ATTEMPT_TTL_HOURS: 24,
  percent,
  validateAnswerKey,
  parseAnswerFields,
  gradeAnswers,
};
