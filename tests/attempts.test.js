'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login } = require('./helpers');

const nowIso = () => new Date().toISOString();

/**
 * Insert one quiz version. `questions` is an array of
 * { prompt, explanation, options: [{ label, correct }] }.
 */
function seedQuiz(db, { slug, version = 1, status = 'published', title = 'Fixture quiz', questions = [] }) {
  const now = nowIso();
  const quizId = Number(
    db
      .prepare(
        `INSERT INTO quizzes (slug, version, title, description, status, passing_score_percent, created_at, updated_at, published_at)
         VALUES (?, ?, ?, 'Fixture description', ?, 70, ?, ?, ?)`,
      )
      .run(slug, version, title, status, now, now, status === 'published' ? now : null).lastInsertRowid,
  );

  const insertQuestion = db.prepare(
    'INSERT INTO quiz_questions (quiz_id, position, prompt, explanation, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertOption = db.prepare(
    'INSERT INTO quiz_options (question_id, position, label, is_correct) VALUES (?, ?, ?, ?)',
  );

  const built = questions.map((question, index) => {
    const questionId = Number(
      insertQuestion.run(quizId, index + 1, question.prompt, question.explanation, now).lastInsertRowid,
    );
    const options = question.options.map((option, optionIndex) =>
      ({
        id: Number(
          insertOption.run(questionId, optionIndex + 1, option.label, option.correct ? 1 : 0).lastInsertRowid,
        ),
        ...option,
      }),
    );
    return { questionId, ...question, options };
  });

  return { quizId, slug, version, questions: built };
}

function standardQuestions() {
  return [
    {
      prompt: 'Q1 which step is safest?',
      explanation: 'Q1 hidden explanation about verifying the sender.',
      options: [
        { label: 'Open the portal yourself', correct: true },
        { label: 'Click the urgent link', correct: false },
      ],
    },
    {
      prompt: 'Q2 which password is strongest?',
      explanation: 'Q2 hidden explanation about length.',
      options: [
        { label: 'P@ssw0rd', correct: false },
        { label: 'A long random passphrase', correct: true },
      ],
    },
  ];
}

function quizWithAnswers(db, overrides = {}) {
  return seedQuiz(db, { slug: 'fixture-quiz', questions: standardQuestions(), ...overrides });
}

async function startAttempt(app, slug, auth) {
  const response = await request(app)
    .post(`/quizzes/${slug}/attempt`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(response.status, 303, `start should redirect: ${response.text}`);
  const match = /^\/attempts\/(\d+)/.exec(response.headers.location);
  assert.ok(match, `unexpected location ${response.headers.location}`);
  return { id: Number(match[1]), response };
}

async function submitAttempt(app, attemptId, auth, fields) {
  return request(app)
    .post(`/attempts/${attemptId}/submit`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken, ...fields });
}

function attemptRow(db, attemptId) {
  return db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attemptId);
}

function answerRows(db, attemptId) {
  return db
    .prepare('SELECT * FROM attempt_answers WHERE attempt_id = ? ORDER BY question_id')
    .all(attemptId);
}

test('starting an attempt pins the published version and resume is idempotent', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const v1 = quizWithAnswers(db);

  const first = await startAttempt(app, v1.slug, auth);
  const row = attemptRow(db, first.id);
  assert.equal(row.quiz_id, v1.quizId);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.max_points, 2);
  assert.equal(row.user_id, user.id);

  // Starting again resumes the same open attempt instead of creating another.
  const second = await startAttempt(app, v1.slug, auth);
  assert.equal(second.id, first.id);
  assert.match(second.response.headers.location, /notice=attempt_resumed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM quiz_attempts').get().total, 1);
});

test('grading is server-side: correct, incorrect, and unanswered questions', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = seedQuiz(db, {
    slug: 'three-question-quiz',
    questions: [
      ...standardQuestions(),
      {
        prompt: 'Q3 which data should stay private?',
        explanation: 'Q3 hidden explanation about personal data.',
        options: [
          { label: 'Your student number', correct: true },
          { label: 'A public course code', correct: false },
        ],
      },
    ],
  });

  const { id } = await startAttempt(app, quiz.slug, auth);
  const response = await submitAttempt(app, id, auth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
    [`q_${quiz.questions[1].questionId}`]: String(quiz.questions[1].options[0].id),
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.location, /notice=attempt_submitted/);

  const row = attemptRow(db, id);
  assert.equal(row.status, 'submitted');
  assert.equal(row.score_points, 1);
  assert.equal(row.max_points, 3);
  assert.ok(row.submitted_at);

  const answers = answerRows(db, id);
  assert.equal(answers.length, 3, 'every question is stored, including blanks');
  assert.equal(answers[0].is_correct, 1);
  assert.equal(answers[1].is_correct, 0);
  assert.equal(answers[2].selected_option_id, null);
  assert.equal(answers[2].is_correct, 0);

  const result = await request(app).get(`/attempts/${id}`).set('Cookie', auth.cookie);
  assert.equal(result.status, 200);
  assert.match(result.text, /33<span>%<\/span>/);
  assert.match(result.text, /1 of 3 correct/);
  assert.match(result.text, /Not answered/);
  assert.match(result.text, /Q1 hidden explanation/);
  assert.match(result.text, /Q3 hidden explanation/);
});

test('a submission with missing or invalid question and option ids is rejected without saving', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = quizWithAnswers(db);
  const { id } = await startAttempt(app, quiz.slug, auth);

  const unknownQuestion = await submitAttempt(app, id, auth, { q_999999: '1' });
  assert.equal(unknownQuestion.status, 400);
  assert.match(unknownQuestion.text, /did not match this quiz/);

  const invalidOption = await submitAttempt(app, id, auth, {
    [`q_${quiz.questions[0].questionId}`]: '999999',
  });
  assert.equal(invalidOption.status, 400);
  assert.match(invalidOption.text, /not a valid option/);

  const malformed = await submitAttempt(app, id, auth, {
    [`q_${quiz.questions[0].questionId}`]: 'not-a-number',
  });
  assert.equal(malformed.status, 400);

  const row = attemptRow(db, id);
  assert.equal(row.status, 'in_progress');
  assert.equal(answerRows(db, id).length, 0);
});

test('a repeated submission never overwrites the completed result', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = quizWithAnswers(db);
  const { id } = await startAttempt(app, quiz.slug, auth);

  const fields = {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
    [`q_${quiz.questions[1].questionId}`]: String(quiz.questions[1].options[1].id),
  };
  await submitAttempt(app, id, auth, fields);
  const saved = attemptRow(db, id);
  assert.equal(saved.score_points, 2);
  const savedAnswers = answerRows(db, id).length;

  const repeat = await submitAttempt(app, id, auth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[1].id),
  });
  assert.equal(repeat.status, 303);
  assert.match(repeat.headers.location, /notice=already_submitted/);

  const after = attemptRow(db, id);
  assert.equal(after.score_points, 2);
  assert.equal(after.status, 'submitted');
  assert.equal(answerRows(db, id).length, savedAnswers);

  // A direct database update of a submitted attempt is refused too.
  assert.throws(
    () => db.prepare('UPDATE quiz_attempts SET score_points = 0 WHERE id = ?').run(id),
    /immutable/,
  );
});

test('a database failure during grading rolls the whole attempt back', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = quizWithAnswers(db);
  const { id } = await startAttempt(app, quiz.slug, auth);

  db.exec(
    `CREATE TRIGGER test_abort_answer_insert BEFORE INSERT ON attempt_answers
     BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;`,
  );

  const response = await submitAttempt(app, id, auth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
  });
  assert.equal(response.status, 500);

  const row = attemptRow(db, id);
  assert.equal(row.status, 'in_progress', 'the attempt must stay open after a failed save');
  assert.equal(row.score_points, 0);
  assert.equal(answerRows(db, id).length, 0, 'no partial answer rows');

  db.exec('DROP TRIGGER test_abort_answer_insert');
  const retry = await submitAttempt(app, id, auth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
  });
  assert.equal(retry.status, 303);
  assert.equal(attemptRow(db, id).status, 'submitted');
  assert.equal(answerRows(db, id).length, 2);
});

test('attempts are private to their owner and closed to administrators', async () => {
  const { app, db, config } = createContext();
  const owner = createUser(db, { email: 'owner@example.test', username: 'owner1' });
  const other = createUser(db, { email: 'other@example.test', username: 'other1' });
  const admin = createUser(db, { email: 'admin@example.test', username: 'boss', role: 'admin' });
  const ownerAuth = login(db, config, owner);
  const otherAuth = login(db, config, other);
  const adminAuth = login(db, config, admin);
  const quiz = quizWithAnswers(db);

  const { id } = await startAttempt(app, quiz.slug, ownerAuth);

  const foreignRead = await request(app).get(`/attempts/${id}`).set('Cookie', otherAuth.cookie);
  assert.equal(foreignRead.status, 404);

  const foreignSubmit = await submitAttempt(app, id, otherAuth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
  });
  assert.equal(foreignSubmit.status, 404);
  assert.equal(attemptRow(db, id).status, 'in_progress');

  const adminStart = await request(app)
    .post(`/quizzes/${quiz.slug}/attempt`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(adminStart.status, 403);

  const adminSubmit = await submitAttempt(app, id, adminAuth, {});
  assert.equal(adminSubmit.status, 403);
});

test('answer keys and explanations are not sent before submission', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = quizWithAnswers(db);
  const { id } = await startAttempt(app, quiz.slug, auth);

  const take = await request(app).get(`/attempts/${id}`).set('Cookie', auth.cookie);
  assert.equal(take.status, 200);
  assert.match(take.text, /Q1 which step is safest\?/);
  assert.doesNotMatch(take.text, /hidden explanation/);
  assert.doesNotMatch(take.text, /is_correct|isCorrect|data-correct/);

  const api = await request(app).get('/api/quizzes/fixture-quiz').set('Cookie', auth.cookie);
  assert.equal(api.status, 200);
  assert.doesNotMatch(JSON.stringify(api.body), /hidden explanation|isCorrect|is_correct|correctOptionIds/);

  const detail = await request(app).get('/quizzes/fixture-quiz').set('Cookie', auth.cookie);
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /hidden explanation/);
});

test('history keeps every attempt and labels the latest and best result', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = quizWithAnswers(db);

  // First attempt: both correct (100%).
  const first = await startAttempt(app, quiz.slug, auth);
  await submitAttempt(app, first.id, auth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
    [`q_${quiz.questions[1].questionId}`]: String(quiz.questions[1].options[1].id),
  });

  // Second attempt: one correct (50%). It becomes the latest, not the best.
  const second = await startAttempt(app, quiz.slug, auth);
  await submitAttempt(app, second.id, auth, {
    [`q_${quiz.questions[0].questionId}`]: String(quiz.questions[0].options[0].id),
    [`q_${quiz.questions[1].questionId}`]: String(quiz.questions[1].options[0].id),
  });

  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM quiz_attempts').get().total, 2);

  const history = await request(app).get('/quizzes/history').set('Cookie', auth.cookie);
  assert.equal(history.status, 200);
  assert.match(history.text, /Completed attempts/);
  assert.match(history.text, /Latest/);
  assert.match(history.text, /Best/);

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.match(dashboard.text, /100<span class="stat-suffix">%<\/span>/, 'best score comes from history');

  // Another student sees an empty history and none of these rows.
  const other = createUser(db, { email: 'other@example.test', username: 'other1' });
  const otherAuth = login(db, config, other);
  const otherHistory = await request(app).get('/quizzes/history').set('Cookie', otherAuth.cookie);
  assert.match(otherHistory.text, /No quiz attempts yet/);
  assert.doesNotMatch(otherHistory.text, /Fixture quiz/);
});

test('historical attempts keep the version they were graded against', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const v1 = quizWithAnswers(db, { version: 1 });

  const { id } = await startAttempt(app, v1.slug, auth);
  await submitAttempt(app, id, auth, {
    [`q_${v1.questions[0].questionId}`]: String(v1.questions[0].options[0].id),
  });

  // A newer published version with different questions and answers appears.
  const v2 = seedQuiz(db, {
    slug: v1.slug,
    version: 2,
    title: 'Fixture quiz v2',
    questions: [
      {
        prompt: 'V2 completely different question',
        explanation: 'V2 explanation.',
        options: [
          { label: 'V2 option A', correct: true },
          { label: 'V2 option B', correct: false },
        ],
      },
    ],
  });
  db.prepare("UPDATE quizzes SET status = 'archived' WHERE id = ?").run(v1.quizId);

  const result = await request(app).get(`/attempts/${id}`).set('Cookie', auth.cookie);
  assert.equal(result.status, 200);
  assert.match(result.text, /Q1 which step is safest\?/);
  assert.match(result.text, /Q1 hidden explanation/);
  assert.doesNotMatch(result.text, /V2 completely different question/);
  assert.match(result.text, /Version 1/);

  const row = attemptRow(db, id);
  assert.equal(row.quiz_id, v1.quizId);
  assert.notEqual(row.quiz_id, v2.quizId);

  const history = await request(app).get('/quizzes/history').set('Cookie', auth.cookie);
  assert.match(history.text, /Fixture quiz/);
});

test('expired attempts are shown honestly and free the student to start again', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const quiz = quizWithAnswers(db);

  const oldStarted = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const staleId = Number(
    db
      .prepare(
        `INSERT INTO quiz_attempts (user_id, quiz_id, status, score_points, max_points, started_at)
         VALUES (?, ?, 'in_progress', 0, 2, ?)`,
      )
      .run(user.id, quiz.quizId, oldStarted).lastInsertRowid,
  );

  const page = await request(app).get(`/attempts/${staleId}`).set('Cookie', auth.cookie);
  assert.equal(page.status, 409);
  assert.match(page.text, /This attempt expired/);
  assert.equal(attemptRow(db, staleId).status, 'expired');

  const submit = await submitAttempt(app, staleId, auth, {});
  assert.equal(submit.status, 303);
  assert.match(submit.headers.location, /notice=attempt_expired/);

  const fresh = await startAttempt(app, quiz.slug, auth);
  assert.notEqual(fresh.id, staleId);
  assert.equal(attemptRow(db, fresh.id).status, 'in_progress');

  const history = await request(app).get('/quizzes/history').set('Cookie', auth.cookie);
  assert.match(history.text, /Expired/);
});

test('empty and misconfigured quizzes cannot be started', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);

  seedQuiz(db, { slug: 'empty-quiz', questions: [] });
  const empty = await request(app)
    .post('/quizzes/empty-quiz/attempt')
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(empty.status, 409);
  assert.match(empty.text, /cannot be started/);

  seedQuiz(db, {
    slug: 'broken-quiz',
    questions: [
      {
        prompt: 'No correct option',
        explanation: 'Broken.',
        options: [
          { label: 'A', correct: false },
          { label: 'B', correct: false },
        ],
      },
    ],
  });
  const broken = await request(app)
    .post('/quizzes/broken-quiz/attempt')
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(broken.status, 409);
  assert.match(broken.text, /not configured correctly/);

  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM quiz_attempts').get().total, 0);
});

test('students cannot access another student history and admins get no student history', async () => {
  const { app, db, config } = createContext();
  const student = createUser(db, {});
  const admin = createUser(db, { email: 'admin@example.test', username: 'boss', role: 'admin' });
  const studentAuth = login(db, config, student);
  const adminAuth = login(db, config, admin);

  const own = await request(app).get('/quizzes/history').set('Cookie', studentAuth.cookie);
  assert.equal(own.status, 200);
  assert.match(own.text, /No quiz attempts yet/);

  const forbidden = await request(app).get('/quizzes/history').set('Cookie', adminAuth.cookie);
  assert.equal(forbidden.status, 403);
});
