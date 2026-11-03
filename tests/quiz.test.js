'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

test('public quiz APIs never expose correct answers or explanations', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const { quizId, quizSlug } = seedContent(db);

  const detail = await request(app).get(`/api/quizzes/${quizSlug}`).set('Cookie', auth.cookie);
  assert.equal(detail.status, 200);

  const serialized = JSON.stringify(detail.body);
  assert.doesNotMatch(serialized, /is_correct|isCorrect|explanation|correctOptionIds|answer/i);
  assert.equal(detail.body.quiz.questions.length, 1);
  assert.equal(detail.body.quiz.questions[0].options.length, 2);

  // The answer key still exists on the server for grading.
  const key = db
    .prepare(
      `SELECT o.is_correct AS isCorrect
         FROM quiz_options o
         JOIN quiz_questions q ON q.id = o.question_id
        WHERE q.quiz_id = ? ORDER BY o.position`,
    )
    .all(quizId)
    .map((row) => row.isCorrect);
  assert.deepEqual(key, [1, 0]);
});

test('the admin quiz preview shows questions without marking the answer', async () => {
  const { app, db, config } = createContext();
  const admin = createUser(db, { email: 'admin@example.test', username: 'boss', role: 'admin' });
  const auth = login(db, config, admin);
  const { quizSlug } = seedContent(db);

  const response = await request(app).get(`/quizzes/${quizSlug}`).set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /Which signal suggests phishing\?/);
  assert.match(response.text, /Administrator preview/);
  assert.doesNotMatch(response.text, /Urgency plus a link is a classic sign/, 'explanations stay server-side');
  assert.doesNotMatch(response.text, /option--correct|data-correct/);
});

test('only published quizzes are listed or reachable', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  seedContent(db);

  const list = await request(app).get('/api/quizzes').set('Cookie', auth.cookie);
  assert.equal(list.status, 200);
  const slugs = list.body.quizzes.map((quiz) => quiz.slug);
  assert.deepEqual(slugs, ['phishing-test-quiz']);
  assert.ok(!slugs.includes('draft-quiz'));

  const draft = await request(app).get('/api/quizzes/draft-quiz').set('Cookie', auth.cookie);
  assert.equal(draft.status, 404);

  const draftPage = await request(app).get('/quizzes/draft-quiz').set('Cookie', auth.cookie);
  assert.equal(draftPage.status, 404);
});

test('the quiz catalogue reports the real question count', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  seedContent(db);

  const response = await request(app).get('/quizzes').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /1 question/);
  assert.match(response.text, /How attempts work/);
  assert.match(response.text, /href="\/quizzes\/[a-z0-9-]+"/);
  assert.doesNotMatch(response.text, /not open yet/);
});

test('an empty catalogue renders an explicit empty state', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);

  const response = await request(app).get('/quizzes').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /No quizzes are published yet/);
});

/** One rendered quiz card, located by its slug data attribute. */
function cardFor(html, slug) {
  const marker = html.indexOf(`data-quiz-slug="${slug}"`);
  if (marker === -1) return '';
  const start = html.lastIndexOf('<li', marker);
  const end = html.indexOf('</li>', marker);
  return html.slice(start, end);
}

test('catalogue attempt chips and buttons match the real attempt records', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const seed = seedContent(db);
  const now = new Date().toISOString();

  // The seeded quiz has one completed attempt: 1/1.
  db.prepare(
    `INSERT INTO quiz_attempts (user_id, quiz_id, status, score_points, max_points, started_at, submitted_at)
     VALUES (?, ?, 'submitted', 1, 1, ?, ?)`,
  ).run(user.id, seed.quizId, now, now);

  const insertQuiz = db.prepare(
    `INSERT INTO quizzes (slug, version, title, description, status, passing_score_percent,
                          created_at, updated_at, published_at)
     VALUES (?, 1, ?, ?, 'published', 70, ?, ?, ?)`,
  );
  insertQuiz.run('not-attempted-quiz', 'Untouched quiz', 'No attempts yet.', now, now, now);
  const openQuizId = Number(
    insertQuiz.run('open-attempt-quiz', 'Open attempt quiz', 'An attempt is in progress.', now, now, now)
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO quiz_attempts (user_id, quiz_id, status, score_points, max_points, started_at)
     VALUES (?, ?, 'in_progress', 0, 2, ?)`,
  ).run(user.id, openQuizId, now);

  const response = await request(app).get('/quizzes').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /data-quiz-filter="not-attempted"/);
  assert.match(response.text, /data-quiz-filter="completed"/);

  const completed = cardFor(response.text, seed.quizSlug);
  assert.match(completed, /data-quiz-attempt="completed"/);
  assert.match(completed, /Best 1\/1/);
  assert.match(completed, />Review</);
  assert.doesNotMatch(completed, /Not attempted/);

  const untouched = cardFor(response.text, 'not-attempted-quiz');
  assert.match(untouched, /data-quiz-attempt="not-attempted"/);
  assert.match(untouched, /Not attempted/);
  assert.match(untouched, />Start quiz</);

  const open = cardFor(response.text, 'open-attempt-quiz');
  assert.match(open, />Resume</);
  assert.match(open, /Not attempted/);
});

test('student filters expose data attributes without rendering admin filter chips', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  seedContent(db);

  const response = await request(app).get('/quizzes').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /data-quiz-search="test quiz a quiz used by the test suite\. phishing-test-quiz"/);
  assert.match(response.text, /data-quiz-status="published"/);
  assert.match(response.text, /data-quiz-attempt="not-attempted"/);
  assert.doesNotMatch(response.text, /data-quiz-filter="draft"|data-quiz-filter="published"|data-quiz-filter="archived"/);
  assert.doesNotMatch(response.text, /data-quiz-archive/);
});
