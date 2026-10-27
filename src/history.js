'use strict';

/**
 * Presentation helpers for a student's own attempt history.
 * Percentages are always derived from the stored score and max points; they
 * are never accepted from the client.
 */

const { percent } = require('./grading');

/**
 * @param {Array<{slug:string, status:string, scorePoints:number, maxPoints:number}>} rows
 *   ordered newest first
 */
function decorateHistory(rows) {
  const perQuizCount = new Map();
  for (const row of rows) {
    perQuizCount.set(row.slug, (perQuizCount.get(row.slug) || 0) + 1);
  }

  const bestByQuiz = new Map();
  for (const row of rows) {
    if (row.status !== 'submitted') continue;
    const value = percent(row.scorePoints, row.maxPoints);
    if (!bestByQuiz.has(row.slug) || value > bestByQuiz.get(row.slug)) {
      bestByQuiz.set(row.slug, value);
    }
  }

  const bestMarked = new Set();
  const latestMarked = new Set();
  return rows.map((row) => {
    const percentage = row.status === 'submitted' ? percent(row.scorePoints, row.maxPoints) : null;
    const latest =
      !latestMarked.has(row.slug) && (perQuizCount.get(row.slug) || 0) > 1;
    if (latest) latestMarked.add(row.slug);
    let isBest = false;
    if (
      row.status === 'submitted' &&
      percentage === bestByQuiz.get(row.slug) &&
      !bestMarked.has(row.slug)
    ) {
      isBest = true;
      bestMarked.add(row.slug);
    }
    return {
      ...row,
      percentage,
      isLatest: latest,
      isBest,
    };
  });
}

/** Dashboard figures, derived only from submitted attempts. */
function summarizeHistory(rows) {
  const submitted = rows.filter((row) => row.status === 'submitted');
  const slugs = new Set(submitted.map((row) => row.slug));
  const best = submitted.reduce(
    (highest, row) => Math.max(highest, percent(row.scorePoints, row.maxPoints)),
    0,
  );
  return {
    completedAttempts: submitted.length,
    quizzesAttempted: slugs.size,
    bestPercentage: submitted.length > 0 ? best : null,
    lastAttemptAt: rows.length > 0 ? rows[0].submittedAt || rows[0].startedAt : null,
  };
}

module.exports = { decorateHistory, summarizeHistory };
