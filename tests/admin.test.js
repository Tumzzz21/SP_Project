'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

const nowIso = () => new Date().toISOString();

function setupRoles() {
  const ctx = createContext();
  const student = createUser(ctx.db, {});
  const admin = createUser(ctx.db, {
    email: 'admin@example.test',
    username: 'admin1',
    displayName: 'Admin One',
    role: 'admin',
  });
  return {
    ...ctx,
    studentAuth: login(ctx.db, ctx.config, student),
    adminAuth: login(ctx.db, ctx.config, admin),
  };
}

function lessonRow(db, id) {
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
}

function quizRow(db, id) {
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// 1. Role enforcement: every management area rejects students and guests
// ---------------------------------------------------------------------------

test('every admin management endpoint rejects students with 403', async () => {
  const { app, studentAuth } = setupRoles();

  const pages = [
    ['get', '/admin'],
    ['get', '/admin/lessons'],
    ['get', '/admin/lessons/new'],
    ['get', '/admin/quizzes'],
    ['get', '/admin/quizzes/new'],
    ['get', '/admin/attempts'],
  ];
  for (const [method, path] of pages) {
    const response = await request(app)[method](path).set('Cookie', studentAuth.cookie);
    assert.equal(response.status, 403, `${method.toUpperCase()} ${path} should be 403`);
    assert.match(response.text, /do not have access/i);
  }

  // State-changing endpoints too (CSRF token present, but role fails).
  const writes = [
    ['post', '/admin/lessons'],
    ['post', '/admin/lessons/1/status'],
    ['post', '/admin/quizzes'],
    ['post', '/admin/quizzes/1/publish'],
    ['post', '/admin/quizzes/1/archive'],
    ['post', '/admin/quizzes/1/new-version'],
  ];
  for (const [method, path] of writes) {
    const response = await request(app)
      [method](path)
      .set('Cookie', studentAuth.cookie)
      .send({ _csrf: studentAuth.csrfToken });
    assert.equal(response.status, 403, `${method.toUpperCase()} ${path} should be 403`);
  }
});

test('guests are sent to login instead of seeing admin pages', async () => {
  const { app } = setupRoles();

  const response = await request(app).get('/admin/lessons');
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^\/login/);

  const write = await request(app).post('/admin/lessons').send({ title: 'x' });
  assert.equal(write.status, 302);
  assert.match(write.headers.location, /^\/login/);
});

test('disabled admins cannot reach the admin area', async () => {
  const { app, db, config } = createContext();
  const disabled = createUser(db, {
    email: 'off@example.test',
    username: 'off1',
    displayName: 'Off Admin',
    role: 'admin',
    status: 'disabled',
  });
  const auth = login(db, config, disabled);
  const response = await request(app).get('/admin').set('Cookie', auth.cookie);
  // The session middleware destroys sessions of disabled accounts immediately,
  // so the guard sees a signed-out visitor and sends them to login.
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^\/login/);
  assert.ok(!response.text.includes('Admin dashboard'), 'no admin content served');
});

// ---------------------------------------------------------------------------
// 2. Lesson management: CRUD + publication transitions
// ---------------------------------------------------------------------------

test('admin creates, edits, publishes, unpublishes, and archives a lesson', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();

  // Create (draft).
  const create = await request(app)
    .post('/admin/lessons')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Recognizing phishing emails',
      slug: 'recognizing-phishing-emails',
      summary: 'How to spot a phishing message before you click.',
      category: 'phishing',
      content: '## Signs\n\n- Urgency\n- Strange sender',
      readingMinutes: 5,
    });
  assert.equal(create.status, 303, create.text);
  const id = Number(/\/admin\/lessons\/(\d+)/.exec(create.headers.location)[1]);

  let row = lessonRow(db, id);
  assert.equal(row.status, 'draft', 'new lessons start as drafts');
  assert.equal(row.published_at, null);

  // Drafts are invisible to students.
  const hidden = await request(app).get('/learn/recognizing-phishing-emails').set('Cookie', studentAuth.cookie);
  assert.equal(hidden.status, 404);

  // Edit while draft.
  const edit = await request(app)
    .post(`/admin/lessons/${id}`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Recognizing phishing emails (revised)',
      slug: 'recognizing-phishing-emails',
      summary: 'How to spot a phishing message before you click.',
      category: 'phishing',
      content: '## Signs\n\n- Urgency\n- Strange sender\n- Mismatched links',
      readingMinutes: 6,
    });
  assert.equal(edit.status, 303, edit.text);
  row = lessonRow(db, id);
  assert.equal(row.title, 'Recognizing phishing emails (revised)');
  assert.equal(row.reading_minutes, 6);

  // Publish → visible to students.
  const publish = await request(app)
    .post(`/admin/lessons/${id}/status`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'published' });
  assert.equal(publish.status, 303);
  assert.match(publish.headers.location, /notice=lesson_published/);
  row = lessonRow(db, id);
  assert.equal(row.status, 'published');
  assert.ok(row.published_at, 'publishing stamps published_at');

  const visible = await request(app).get('/learn/recognizing-phishing-emails').set('Cookie', studentAuth.cookie);
  assert.equal(visible.status, 200);
  assert.match(visible.text, /Recognizing phishing emails/);

  // Unpublish → back to draft, hidden again, progress untouched.
  const unpublish = await request(app)
    .post(`/admin/lessons/${id}/status`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'draft' });
  assert.equal(unpublish.status, 303);
  assert.match(unpublish.headers.location, /notice=lesson_unpublished/);
  assert.equal(lessonRow(db, id).status, 'draft');
  const hiddenAgain = await request(app).get('/learn/recognizing-phishing-emails').set('Cookie', studentAuth.cookie);
  assert.equal(hiddenAgain.status, 404);

  // Archive from published.
  await request(app)
    .post(`/admin/lessons/${id}/status`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'published' });
  const archive = await request(app)
    .post(`/admin/lessons/${id}/status`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'archived' });
  assert.equal(archive.status, 303);
  assert.match(archive.headers.location, /notice=lesson_archived/);
  assert.equal(lessonRow(db, id).status, 'archived');

  // Invalid status value is rejected.
  const bad = await request(app)
    .post(`/admin/lessons/${id}/status`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'nonsense' });
  assert.equal(bad.status, 400);
});

test('lesson slug conflicts are rejected with a field error', async () => {
  const { app, adminAuth } = setupRoles();

  const first = await request(app)
    .post('/admin/lessons')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'First lesson',
      slug: 'unique-slug-here',
      summary: 'Summary text that is long enough to pass validation.',
      category: 'phishing',
      content: 'Some content for the lesson body.',
      readingMinutes: 4,
    });
  assert.equal(first.status, 303, first.text);

  const second = await request(app)
    .post('/admin/lessons')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Second lesson',
      slug: 'unique-slug-here',
      summary: 'Summary text that is long enough to pass validation.',
      category: 'phishing',
      content: 'Some content for the lesson body.',
      readingMinutes: 4,
    });
  assert.equal(second.status, 409, 'duplicate slug should be a conflict');
  assert.match(second.text, /already in use/);
});

test('lesson validation rejects missing or invalid fields', async () => {
  const { app, adminAuth } = setupRoles();

  const response = await request(app)
    .post('/admin/lessons')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'x', // too short
      slug: '!!!', // normalises to empty → rejected
      summary: 'short',
      category: 'not-a-category',
      content: '',
      readingMinutes: '999',
    });
  assert.equal(response.status, 400);
  assert.match(response.text, /Title must be|Enter a quiz title|3-120|3–120/);
  assert.match(response.text, /Enter a URL slug\./);
});

test('lesson content renders escaped: no script execution from author HTML', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();

  const create = await request(app)
    .post('/admin/lessons')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Unsafe content test',
      slug: 'unsafe-content-test',
      summary: 'Checking that raw HTML in lesson content never executes.',
      category: 'ethics',
      content: '<script>window.__pwned = true;</script>\n\n## Heading',
      readingMinutes: 3,
    });
  assert.equal(create.status, 303, create.text);
  const id = Number(/\/admin\/lessons\/(\d+)/.exec(create.headers.location)[1]);

  await request(app)
    .post(`/admin/lessons/${id}/status`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'published' });

  const preview = await request(app)
    .get(`/admin/lessons/${id}/preview`)
    .set('Cookie', adminAuth.cookie);
  assert.equal(preview.status, 200);
  assert.ok(!preview.text.includes('<script>window.__pwned'), 'script tag must be escaped in preview');
  assert.match(preview.text, /&lt;script&gt;/);

  const studentView = await request(app)
    .get('/learn/unsafe-content-test')
    .set('Cookie', studentAuth.cookie);
  assert.equal(studentView.status, 200);
  assert.ok(!studentView.text.includes('<script>window.__pwned'), 'script tag must be escaped for students');
});

test('student lesson progress survives admin edits, republish, and archive', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const seed = seedContent(db);

  // Student completes the seeded published lesson.
  const complete = await request(app)
    .post(`/learn/${seed.lessonSlug}/complete`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken });
  assert.equal(complete.status, 303, complete.text);

  const lesson = db.prepare('SELECT id FROM lessons WHERE slug = ?').get(seed.lessonSlug);
  const progressBefore = db
    .prepare('SELECT * FROM lesson_progress WHERE lesson_id = ?')
    .all(lesson.id);
  assert.equal(progressBefore.length, 1);
  assert.equal(progressBefore[0].state, 'completed');

  // Admin edits title/content, unpublishes, republishes, then archives.
  await request(app)
    .post(`/admin/lessons/${lesson.id}`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Renamed phishing lesson',
      slug: seed.lessonSlug,
      summary: 'A lesson used by the test suite, now renamed.',
      category: 'phishing',
      content: '## Changed\n\nNew body.',
      readingMinutes: 5,
    });
  for (const status of ['draft', 'published', 'archived']) {
    const response = await request(app)
      .post(`/admin/lessons/${lesson.id}/status`)
      .set('Cookie', adminAuth.cookie)
      .send({ _csrf: adminAuth.csrfToken, status });
    assert.equal(response.status, 303, `transition to ${status}`);
  }

  const progressAfter = db.prepare('SELECT * FROM lesson_progress WHERE lesson_id = ?').all(lesson.id);
  assert.equal(progressAfter.length, 1, 'progress row still exists');
  assert.equal(progressAfter[0].state, 'completed', 'progress state unchanged');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE id = ?').get(lesson.id).n,
    1,
    'lesson row was archived, never deleted',
  );
});

// ---------------------------------------------------------------------------
// 3. Quiz authoring: draft validation, publish, immutability, versioning
// ---------------------------------------------------------------------------

test('admin creates a draft quiz, saves questions, and publishes it', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();

  const create = await request(app)
    .post('/admin/quizzes')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Phishing basics check',
      slug: 'phishing-basics-check',
      description: 'Short check after the phishing lessons.',
      passingScorePercent: 60,
    });
  assert.equal(create.status, 303, create.text);
  const id = Number(/\/admin\/quizzes\/(\d+)/.exec(create.headers.location)[1]);

  let quiz = quizRow(db, id);
  assert.equal(quiz.status, 'draft');
  assert.equal(quiz.version, 1);

  // Drafts hidden from students.
  const hidden = await request(app).get('/quizzes/phishing-basics-check').set('Cookie', studentAuth.cookie);
  assert.equal(hidden.status, 404);

  // Save questions (scalar fields — urlencoded gives no arrays).
  const save = await request(app)
    .post(`/admin/quizzes/${id}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'Which is a phishing sign?',
      q_0_explanation: 'Unexpected urgency plus links is the classic pattern.',
      q_0_opt_0: 'An email demanding action in 10 minutes',
      q_0_opt_1: 'A newsletter you subscribed to',
      q_0_correct: '0',
      q_1_prompt: 'What should you do with a suspicious link?',
      q_1_explanation: 'Hovering first shows the real destination.',
      q_1_opt_0: 'Click it to check quickly',
      q_1_opt_1: 'Hover over it to inspect the destination',
      q_1_correct: '1',
    });
  assert.equal(save.status, 303, save.text);
  assert.match(save.headers.location, /notice=quiz_questions_saved/);

  const questionCount = db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?').get(id).n;
  assert.equal(questionCount, 2);
  const correctCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM quiz_options o
         JOIN quiz_questions q ON q.id = o.question_id
        WHERE q.quiz_id = ? AND o.is_correct = 1`,
    )
    .get(id).n;
  assert.equal(correctCount, 2, 'exactly one correct per question');

  // Invalid question set: only one option → rejected, nothing saved.
  const invalid = await request(app)
    .post(`/admin/quizzes/${id}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'Broken question',
      q_0_opt_0: 'Only option',
      q_0_correct: '0',
    });
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /at least two answer options/);

  // Publish → visible, frozen.
  const publish = await request(app)
    .post(`/admin/quizzes/${id}/publish`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(publish.status, 303, publish.text);
  assert.match(publish.headers.location, /notice=quiz_published/);
  assert.equal(quizRow(db, id).status, 'published');

  const visible = await request(app).get('/quizzes/phishing-basics-check').set('Cookie', studentAuth.cookie);
  assert.equal(visible.status, 200);
});

test('publishing an empty or invalid draft is refused', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db); // includes draft-quiz with no questions

  const draft = db.prepare("SELECT id FROM quizzes WHERE slug = 'draft-quiz'").get();
  const empty = await request(app)
    .post(`/admin/quizzes/${draft.id}/publish`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(empty.status, 400);
  assert.match(empty.text, /Add at least one question before publishing/);
  assert.equal(quizRow(db, draft.id).status, 'draft', 'still a draft');
  void seed;
});

test('a published quiz version is immutable: no in-place edits, no direct SQL', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);

  // Editing metadata of the published version is refused.
  const meta = await request(app)
    .post(`/admin/quizzes/${seed.quizId}`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Sneaky rename',
      description: 'nope',
      passingScorePercent: 10,
    });
  assert.equal(meta.status, 409);
  assert.match(meta.text, /Only draft quiz versions can be edited/);
  assert.equal(quizRow(db, seed.quizId).title, 'Test quiz', 'title unchanged');

  // Replacing questions of the published version is refused.
  const questions = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'Replaced prompt?',
      q_0_opt_0: 'A',
      q_0_opt_1: 'B',
      q_0_correct: '0',
    });
  assert.equal(questions.status, 409);
  assert.match(questions.text, /Only draft quiz versions can be edited/);

  const prompt = db
    .prepare('SELECT prompt FROM quiz_questions WHERE quiz_id = ? ORDER BY position LIMIT 1')
    .get(seed.quizId).prompt;
  assert.equal(prompt, 'Which signal suggests phishing?', 'stored prompt unchanged');

  // Even raw SQL is blocked by the migration triggers.
  assert.throws(
    () => db.prepare('UPDATE quiz_questions SET prompt = ? WHERE quiz_id = ?').run('tampered', seed.quizId),
    /immutable/,
  );
  assert.throws(
    () => db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(seed.quizId),
    /immutable/,
  );
});

test('editing a published quiz creates a new draft version; old attempts keep their version', async () => {
  const { app, db, adminAuth, studentAuth, config } = setupRoles();
  const seed = seedContent(db);

  // A student answers version 1 and submits.
  const start = await request(app)
    .post(`/quizzes/${seed.quizSlug}/attempt`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken });
  assert.equal(start.status, 303, start.text);
  const attemptId = Number(/\/attempts\/(\d+)/.exec(start.headers.location)[1]);

  const option = db
    .prepare('SELECT id FROM quiz_options WHERE question_id = ? AND is_correct = 1')
    .get(seed.questionId);
  const submit = await request(app)
    .post(`/attempts/${attemptId}/submit`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken, [`q_${seed.questionId}`]: String(option.id) });
  assert.equal(submit.status, 303, submit.text);

  const attemptBefore = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attemptId);
  assert.equal(attemptBefore.status, 'submitted');
  assert.equal(attemptBefore.quiz_id, seed.quizId, 'attempt pinned to version 1');

  // Admin creates a new version from the published one.
  const newVersion = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/new-version`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(newVersion.status, 303, newVersion.text);
  assert.match(newVersion.headers.location, /notice=quiz_version_created/);
  const newId = Number(/\/admin\/quizzes\/(\d+)/.exec(newVersion.headers.location)[1]);

  let copy = quizRow(db, newId);
  assert.equal(copy.version, 2);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.slug, seed.quizSlug);

  // Question content was copied, and the published v1 is untouched.
  const newQuestions = db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?').get(newId).n;
  assert.equal(newQuestions, 1, 'draft copy carries the questions');
  const v1Prompt = db
    .prepare('SELECT prompt FROM quiz_questions WHERE quiz_id = ?')
    .get(seed.quizId).prompt;
  assert.equal(v1Prompt, 'Which signal suggests phishing?');

  // Requesting another new version while a draft exists is refused politely.
  const again = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/new-version`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(again.status, 303);
  assert.match(again.headers.location, /notice=quiz_draft_exists/);
  const drafts = db
    .prepare("SELECT COUNT(*) AS n FROM quizzes WHERE slug = ? AND status = 'draft'")
    .get(seed.quizSlug).n;
  assert.equal(drafts, 1, 'no duplicate drafts');

  // The new version gets different questions, then publishes.
  await request(app)
    .post(`/admin/quizzes/${newId}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'Version two prompt?',
      q_0_explanation: 'New explanation.',
      q_0_opt_0: 'Correct answer two',
      q_0_opt_1: 'Wrong answer two',
      q_0_correct: '0',
    });
  const publishV2 = await request(app)
    .post(`/admin/quizzes/${newId}/publish`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(publishV2.status, 303, publishV2.text);

  // Students now see version 2 (overview shows the version number; prompts
  // only appear inside a live attempt, so start one to check the content).
  const studentView = await request(app).get(`/quizzes/${seed.quizSlug}`).set('Cookie', studentAuth.cookie);
  assert.equal(studentView.status, 200);
  assert.match(studentView.text, /Version<\/span><span>2<\/span>/);

  const retry = await request(app)
    .post(`/quizzes/${seed.quizSlug}/attempt`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken });
  assert.equal(retry.status, 303, retry.text);
  const retryId = Number(/\/attempts\/(\d+)/.exec(retry.headers.location)[1]);
  const takeView = await request(app).get(`/attempts/${retryId}`).set('Cookie', studentAuth.cookie);
  assert.equal(takeView.status, 200);
  assert.match(takeView.text, /Version two prompt/, 'live attempt serves version 2 questions');

  // The historical attempt still references version 1 with its original data.
  const attemptAfter = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attemptId);
  assert.equal(attemptAfter.quiz_id, seed.quizId, 'attempt still pinned to v1');
  assert.equal(attemptAfter.score_points, attemptBefore.score_points, 'score unchanged');
  assert.equal(attemptAfter.status, 'submitted');

  const oldPrompt = db
    .prepare(
      `SELECT prompt FROM quiz_questions
        WHERE id = (SELECT question_id FROM attempt_answers WHERE attempt_id = ?)`,
    )
    .get(attemptId).prompt;
  assert.equal(oldPrompt, 'Which signal suggests phishing?', 'answered question text preserved');

  // The attempt result page still shows the original question.
  const result = await request(app).get(`/attempts/${attemptId}`).set('Cookie', studentAuth.cookie);
  assert.equal(result.status, 200);
  assert.match(result.text, /Which signal suggests phishing\?/);
  void config;
});

// ---------------------------------------------------------------------------
// 4. Answer-key secrecy
// ---------------------------------------------------------------------------

test('answer keys never leak through student pages or public APIs', async () => {
  const { app, db, studentAuth, adminAuth } = setupRoles();
  const seed = seedContent(db);

  const explanation = 'Urgency plus a link is a classic sign.';

  // Student quiz overview: no correctness or explanation before submission.
  const page = await request(app).get(`/quizzes/${seed.quizSlug}`).set('Cookie', studentAuth.cookie);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes(explanation), 'explanation must not appear before submission');
  assert.ok(!page.text.includes('is_correct') && !page.text.includes('isCorrect'), 'no correctness on overview');

  // The take view shows prompts and options, still without any answer key.
  const start = await request(app)
    .post(`/quizzes/${seed.quizSlug}/attempt`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken });
  assert.equal(start.status, 303, start.text);
  const attemptId = Number(/\/attempts\/(\d+)/.exec(start.headers.location)[1]);
  const take = await request(app).get(`/attempts/${attemptId}`).set('Cookie', studentAuth.cookie);
  assert.equal(take.status, 200);
  assert.match(take.text, /Which signal suggests phishing\?/, 'prompts are visible while taking a quiz');
  assert.ok(!take.text.includes(explanation), 'no explanations in the take view');
  assert.ok(!take.text.includes('is_correct') && !take.text.includes('isCorrect'), 'no correctness in the take view');

  // Public API shape: no is_correct / explanation fields.
  const api = await request(app)
    .get(`/api/quizzes/${seed.quizSlug}`)
    .set('Cookie', studentAuth.cookie)
    .set('Accept', 'application/json');
  assert.equal(api.status, 200);
  const body = JSON.stringify(api.body);
  assert.ok(!body.includes('isCorrect') && !body.includes('is_correct'), 'no correctness flag in API');
  assert.ok(!body.includes(explanation), 'no explanation in API');

  // Draft quiz is not served by the public API at all.
  const draftApi = await request(app)
    .get('/api/quizzes/draft-quiz')
    .set('Cookie', studentAuth.cookie)
    .set('Accept', 'application/json');
  assert.equal(draftApi.status, 404);

  // Admin preview uses the same public shape (no key), while the edit page
  // (admin-only) legitimately shows the key.
  const preview = await request(app)
    .get(`/admin/quizzes/${seed.quizId}/preview`)
    .set('Cookie', adminAuth.cookie);
  assert.equal(preview.status, 200);
  assert.ok(!preview.text.includes(explanation), 'preview must not expose explanations');
  assert.match(preview.text, /Which signal suggests phishing\?/);
});

// ---------------------------------------------------------------------------
// 5. Attempt review: admin-only and strictly read-only
// ---------------------------------------------------------------------------

test('attempt review is admin-only and renders the full answer comparison', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const seed = seedContent(db);

  // Student submits one attempt.
  const start = await request(app)
    .post(`/quizzes/${seed.quizSlug}/attempt`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken });
  const attemptId = Number(/\/attempts\/(\d+)/.exec(start.headers.location)[1]);
  const option = db.prepare('SELECT id FROM quiz_options WHERE question_id = ? AND is_correct = 1').get(seed.questionId);
  await request(app)
    .post(`/attempts/${attemptId}/submit`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken, [`q_${seed.questionId}`]: String(option.id) });

  // Student cannot open the review pages.
  const deniedList = await request(app).get('/admin/attempts').set('Cookie', studentAuth.cookie);
  assert.equal(deniedList.status, 403);
  const deniedDetail = await request(app).get(`/admin/attempts/${attemptId}`).set('Cookie', studentAuth.cookie);
  assert.equal(deniedDetail.status, 403);

  // Admin sees the list with student, quiz version, score, timestamp.
  const list = await request(app).get('/admin/attempts').set('Cookie', adminAuth.cookie);
  assert.equal(list.status, 200);
  assert.match(list.text, /Student One/);
  assert.match(list.text, /v1/);

  // Admin detail shows selected + correct answers, explanations, read-only note.
  const detail = await request(app).get(`/admin/attempts/${attemptId}`).set('Cookie', adminAuth.cookie);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /A deadline plus a login link/); // correct answer shown
  assert.match(detail.text, /correct/i);
  assert.match(detail.text, /Urgency plus a link is a classic sign\./); // explanation
  assert.match(detail.text, /Read-only|cannot be edited/i);

  // There is NO write endpoint for attempts: POST to the review paths is 404.
  const postList = await request(app)
    .post('/admin/attempts')
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, status: 'changed' });
  assert.equal(postList.status, 404);
  const postDetail = await request(app)
    .post(`/admin/attempts/${attemptId}`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, score: 100 });
  assert.equal(postDetail.status, 404);

  // And the stored score is exactly what grading produced — untouched.
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attemptId);
  assert.equal(attempt.score_points, 1);
  assert.equal(attempt.max_points, 1);
  assert.throws(
    () => db.prepare('UPDATE quiz_attempts SET score_points = 999 WHERE id = ?').run(attemptId),
    /immutable/,
  );
});

test('attempt detail for an unknown id returns 404', async () => {
  const { app, adminAuth } = setupRoles();
  const response = await request(app).get('/admin/attempts/99999').set('Cookie', adminAuth.cookie);
  assert.equal(response.status, 404);
});

// ---------------------------------------------------------------------------
// 6. Dashboard stats are database-backed
// ---------------------------------------------------------------------------

test('admin dashboard reports live student, content, and participation stats', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const seed = seedContent(db);

  // One submitted attempt.
  const start = await request(app)
    .post(`/quizzes/${seed.quizSlug}/attempt`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken });
  const attemptId = Number(/\/attempts\/(\d+)/.exec(start.headers.location)[1]);
  const option = db.prepare('SELECT id FROM quiz_options WHERE question_id = ? AND is_correct = 1').get(seed.questionId);
  await request(app)
    .post(`/attempts/${attemptId}/submit`)
    .set('Cookie', studentAuth.cookie)
    .send({ _csrf: studentAuth.csrfToken, [`q_${seed.questionId}`]: String(option.id) });

  const response = await request(app).get('/admin').set('Cookie', adminAuth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /Admin overview/);
  assert.match(response.text, /ACTIVE STUDENTS/);
  assert.match(response.text, /PUBLISHED LESSONS/);
  assert.match(response.text, /PUBLISHED QUIZ VERSIONS/);
  assert.match(response.text, /QUIZ PARTICIPATION/);
  assert.match(response.text, /100%/, 'average score of the perfect attempt');
  assert.match(response.text, /Manage lessons/);
  assert.match(response.text, /Attempt review/);
});

// ---------------------------------------------------------------------------
// 7. Shared admin tab row: present on every page, one active section
// ---------------------------------------------------------------------------

const TAB_PAGES = [
  ['/admin', '/admin'],
  ['/admin/lessons', '/admin/lessons'],
  ['/admin/quizzes', '/admin/quizzes'],
  ['/admin/attempts', '/admin/attempts'],
];

/** The shared tab row markup, or null when the page does not render one. */
function adminTabRow(html) {
  const match = /<nav class="filter-bar" aria-label="Admin sections">([\s\S]*?)<\/nav>/.exec(html);
  return match ? match[1] : null;
}

test('the admin tab row lists every section and marks the current one', async () => {
  const { app, adminAuth } = setupRoles();

  for (const [path, activeHref] of TAB_PAGES) {
    const response = await request(app).get(path).set('Cookie', adminAuth.cookie);
    assert.equal(response.status, 200, `${path} renders`);

    const row = adminTabRow(response.text);
    assert.ok(row, `${path} renders the admin tab row`);

    const hrefs = [...row.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      hrefs,
      ['/admin', '/admin/lessons', '/admin/quizzes', '/admin/attempts'],
      `${path} lists all four sections in order`,
    );

    const active = [...row.matchAll(/class="chip is-active"[\s\S]*?href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(active, [activeHref], `${path} highlights exactly one section`);
    assert.equal((row.match(/aria-current="page"/g) || []).length, 1, `${path} exposes one aria-current`);
  }
});

test('the dashboard header no longer stacks the three section buttons', async () => {
  const { app, adminAuth } = setupRoles();
  const response = await request(app).get('/admin').set('Cookie', adminAuth.cookie);

  assert.equal(response.status, 200);

  const head = /<header class="page-head">([\s\S]*?)<\/header>/.exec(response.text);
  assert.ok(head, 'the dashboard keeps its page header');
  assert.ok(!head[1].includes('<a'), 'the page header carries no action links');

  // the section links still exist, now provided by the tab row instead
  const row = adminTabRow(response.text);
  assert.ok(row, 'the tab row carries the section links');
});
