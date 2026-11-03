'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');


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
    ['get', '/admin/modules'],
    ['get', '/admin/modules/new'],
    ['get', '/admin/quizzes'],
    ['get', '/admin/quizzes/new'],
    ['get', '/admin/attempts'],
    ['get', '/admin/students'],
  ];
  for (const [method, path] of pages) {
    const response = await request(app)[method](path).set('Cookie', studentAuth.cookie);
    assert.equal(response.status, 403, `${method.toUpperCase()} ${path} should be 403`);
    assert.match(response.text, /do not have access/i);
  }

  // State-changing endpoints too (CSRF token present, but role fails).
  const writes = [
    ['post', '/admin/modules'],
    ['post', '/admin/quizzes'],
    ['post', '/admin/quizzes/1/publish'],
    ['post', '/admin/quizzes/1/archive'],
    ['post', '/admin/quizzes/1/restore'],
    ['post', '/admin/quizzes/1/delete'],
    ['post', '/admin/quizzes/1/new-version'],
  ];
  for (const [method, path] of writes) {
    const response = await request(app)[method](path).set('Cookie', studentAuth.cookie).send({ _csrf: studentAuth.csrfToken });
    assert.equal(response.status, 403, `${method.toUpperCase()} ${path} should be 403`);
  }
});

test('guests are sent to login instead of seeing admin pages', async () => {
  const { app } = setupRoles();

  const response = await request(app).get('/admin/modules');
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^\/login/);

  const write = await request(app).post('/admin/modules').send({ title: 'x' });
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

test('admin creates a draft quiz, saves questions, and publishes it', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();

  const create = await request(app)
    .post('/admin/quizzes')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'Phishing basics check',
      description: 'Short check after the phishing lessons.',
      passingScorePercent: 60,
    });
  assert.equal(create.status, 303, create.text);
  const id = Number(/\/admin\/quizzes\/(\d+)/.exec(create.headers.location)[1]);

  let quiz = quizRow(db, id);
  assert.equal(quiz.status, 'draft');
  assert.equal(quiz.version, 1);
  assert.equal(quiz.slug, 'phishing-basics-check', 'slug generated from the title');

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
      q_0_opt_2: 'A password reset request',
      q_0_opt_3: 'A software update notification',
      q_0_correct: '0',
      q_1_prompt: 'What should you do with a suspicious link?',
      q_1_explanation: 'Hovering first shows the real destination.',
      q_1_opt_0: 'Click it to check quickly',
      q_1_opt_1: 'Hover over it to inspect the destination',
      q_1_opt_2: 'Forward it to a friend',
      q_1_opt_3: 'Ignore it completely',
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
  assert.match(invalid.text, /provide exactly four answer options/);

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

test('quiz slugs are generated from the title and de-duplicated', async () => {
  const { app, db, adminAuth } = setupRoles();

  const createQuiz = (title) =>
    request(app)
      .post('/admin/quizzes')
      .set('Cookie', adminAuth.cookie)
      .send({ _csrf: adminAuth.csrfToken, title });

  const slugOf = (response) =>
    quizRow(db, Number(/\/admin\/quizzes\/(\d+)/.exec(response.headers.location)[1])).slug;

  // The create form no longer offers a slug field.
  const form = await request(app).get('/admin/quizzes/new').set('Cookie', adminAuth.cookie);
  assert.equal(form.status, 200);
  assert.doesNotMatch(form.text, /name="slug"/);
  assert.doesNotMatch(form.text, /id="slug"/);

  // Spaces, punctuation, and capitals collapse into a URL-friendly slug.
  const messy = await createQuiz("C++ & Python: A Beginner's Guide!");
  assert.equal(messy.status, 303, messy.text);
  assert.equal(slugOf(messy), 'c-python-a-beginners-guide');

  // A colliding title is suffixed instead of becoming version 2 of the first.
  const clash = await createQuiz("C++ & Python: A Beginner's Guide!");
  assert.equal(clash.status, 303, clash.text);
  const clashId = Number(/\/admin\/quizzes\/(\d+)/.exec(clash.headers.location)[1]);
  assert.equal(quizRow(db, clashId).slug, 'c-python-a-beginners-guide-2');
  assert.equal(quizRow(db, clashId).version, 1, 'a new family, not a new version');

  const third = await createQuiz("C++ & Python: A Beginner's Guide!");
  assert.equal(third.status, 303, third.text);
  assert.equal(slugOf(third), 'c-python-a-beginners-guide-3');

  // Overlong titles are trimmed to 80 characters without a trailing hyphen.
  const long = await createQuiz('word '.repeat(20).trim());
  assert.equal(long.status, 303, long.text);
  const longSlug = slugOf(long);
  assert.ok(longSlug.length <= 80, `slug is ${longSlug.length} characters`);
  assert.match(longSlug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);

  // A title with no usable characters still produces a valid slug.
  const symbols = await createQuiz('!!! ??? ***');
  assert.equal(symbols.status, 303, symbols.text);
  assert.match(slugOf(symbols), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);

  // A submitted slug is ignored: it cannot be smuggled in to hijack a family.
  const smuggled = await request(app)
    .post('/admin/quizzes')
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, title: 'Fresh title here', slug: 'c-python-a-beginners-guide' });
  assert.equal(smuggled.status, 303, smuggled.text);
  assert.equal(slugOf(smuggled), 'fresh-title-here');
});

test('a quiz can be attached to a learning module and shows up on its page', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const seed = seedContent(db);
  const modulePath = `/modules/${seed.moduleId}`;

  const modulePage = () =>
    request(app).get(modulePath).set('Cookie', studentAuth.cookie);

  // Creating a quiz with a module stores the association.
  const create = await request(app)
    .post('/admin/quizzes')
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      title: 'SDF module test',
      description: 'Short check on the SDF module content.',
      passingScorePercent: 80,
      module_id: String(seed.moduleId),
    });
  assert.equal(create.status, 303, create.text);
  const id = Number(/\/admin\/quizzes\/(\d+)/.exec(create.headers.location)[1]);
  const quiz = quizRow(db, id);
  assert.equal(quiz.module_id, seed.moduleId);

  // A draft is not advertised to students yet.
  let page = await modulePage();
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /Quizzes in this module/);
  assert.doesNotMatch(page.text, /SDF module test/);

  // Publish it with a valid four-option question.
  await request(app)
    .post(`/admin/quizzes/${id}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'What does SDF stand for?',
      q_0_explanation: 'Service Data Function.',
      q_0_opt_0: 'Service Data Function',
      q_0_opt_1: 'Secure Data File',
      q_0_opt_2: 'System Data Format',
      q_0_opt_3: 'Signed Document Form',
      q_0_correct: '0',
    });
  const publish = await request(app)
    .post(`/admin/quizzes/${id}/publish`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(publish.status, 303, publish.text);

  page = await modulePage();
  assert.match(page.text, /Quizzes in this module/);
  assert.match(page.text, /SDF module test/);
  assert.match(page.text, new RegExp(`href="/quizzes/${quiz.slug}"`));

  // The module list's expandable row lists the quiz too, not just module items.
  const moduleList = await request(app).get('/modules').set('Cookie', studentAuth.cookie);
  assert.equal(moduleList.status, 200);
  assert.match(moduleList.text, new RegExp(`data-module-quiz="${quiz.slug}"`));
  assert.match(moduleList.text, new RegExp(`href="/quizzes/${quiz.slug}"`));
  assert.match(moduleList.text, /1 quiz/);

  // A module the admin cannot see (invalid id) is rejected with a field error.
  const invalid = await request(app)
    .post('/admin/quizzes')
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, title: 'Ghost module quiz', module_id: '999999' });
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /Choose a valid learning module/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM quizzes WHERE title = 'Ghost module quiz'").get().n,
    0,
    'nothing was created',
  );

  // The module link is editable while the quiz is a draft: attach, then detach.
  const draft = db.prepare("SELECT id FROM quizzes WHERE slug = 'draft-quiz'").get();
  const attach = await request(app)
    .post(`/admin/quizzes/${draft.id}`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, title: 'Draft quiz', description: 'Not visible to students.', passingScorePercent: '70', maxAttempts: '', module_id: String(seed.moduleId) });
  assert.equal(attach.status, 303, attach.text);
  assert.equal(quizRow(db, draft.id).module_id, seed.moduleId);

  const detach = await request(app)
    .post(`/admin/quizzes/${draft.id}`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, title: 'Draft quiz', description: 'Not visible to students.', passingScorePercent: '70', maxAttempts: '', module_id: '' });
  assert.equal(detach.status, 303, detach.text);
  assert.equal(quizRow(db, draft.id).module_id, null, 'blank select clears the module');

  // A new version keeps the module of the version it was copied from.
  const nextVersion = await request(app)
    .post(`/admin/quizzes/${id}/new-version`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(nextVersion.status, 303, nextVersion.text);
  const copyId = Number(/\/admin\/quizzes\/(\d+)/.exec(nextVersion.headers.location)[1]);
  assert.equal(quizRow(db, copyId).module_id, seed.moduleId);
});

test('publishing an empty or invalid draft is refused', async () => {
  const { app, db, adminAuth, config } = setupRoles();
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

test('the quiz catalogue shows admin controls only to admins', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const { quizId } = seedContent(db);
  const draftId = db.prepare("SELECT id FROM quizzes WHERE slug = 'draft-quiz'").get().id;

  const adminCatalogue = await request(app).get('/quizzes').set('Cookie', adminAuth.cookie);
  assert.equal(adminCatalogue.status, 200);
  assert.match(adminCatalogue.text, /href="\/admin\/quizzes\/new"[^>]*>\+ New quiz/);
  assert.match(adminCatalogue.text, /data-quiz-menu-toggle/);
  assert.match(adminCatalogue.text, /aria-haspopup="menu"/);
  assert.match(adminCatalogue.text, /aria-expanded="false"/);
  assert.match(adminCatalogue.text, /class="quiz-status-chip quiz-status-chip--draft">Draft</);
  assert.match(adminCatalogue.text, /class="quiz-status-chip quiz-status-chip--published">Published</);
  assert.match(adminCatalogue.text, new RegExp(`href="/admin/quizzes/${draftId}"[^>]*>Edit`));
  assert.match(adminCatalogue.text, new RegExp(`action="/admin/quizzes/${draftId}/publish"`));
  assert.match(adminCatalogue.text, new RegExp(`href="/admin/quizzes/${quizId}"[^>]*>Edit`));
  assert.match(adminCatalogue.text, new RegExp(`action="/admin/quizzes/${quizId}/archive"`));
  assert.doesNotMatch(adminCatalogue.text, /style="display:inline"/);
  assert.doesNotMatch(adminCatalogue.text, /class="btn btn-ghost btn-sm"[^>]*>Edit</);

  const studentCatalogue = await request(app).get('/quizzes').set('Cookie', studentAuth.cookie);
  assert.equal(studentCatalogue.status, 200);
  assert.doesNotMatch(studentCatalogue.text, /New quiz|>Edit<|>Publish<|>Archive</);
  assert.doesNotMatch(studentCatalogue.text, /data-quiz-menu|quiz-status-chip|href="\/admin\/quizzes/);
  assert.doesNotMatch(studentCatalogue.text, /draft-quiz/);
});

test('students see no admin controls in the quiz catalogue', async () => {
  const { app, db, studentAuth } = setupRoles();
  seedContent(db);

  const response = await request(app).get('/quizzes').set('Cookie', studentAuth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /data-quiz-card/);
  assert.doesNotMatch(response.text, /data-quiz-menu-toggle|data-quiz-menu-panel|quiz-status-chip|href="\/admin\/quizzes/);
  assert.doesNotMatch(response.text, /\+ New quiz/);
});

test('admins see an accessible overflow menu on every live quiz card', async () => {
  const { app, db, adminAuth } = setupRoles();
  const { quizId } = seedContent(db);
  const draftId = db.prepare("SELECT id FROM quizzes WHERE slug = 'draft-quiz'").get().id;

  const response = await request(app).get('/quizzes').set('Cookie', adminAuth.cookie);
  assert.equal(response.status, 200);

  assert.match(response.text, /class="quiz-menu-toggle"/);
  assert.match(response.text, /aria-haspopup="menu"/);
  assert.match(response.text, /aria-expanded="false"/);
  assert.match(response.text, /aria-label="More actions for Test quiz"/);
  assert.match(response.text, new RegExp(`id="quiz-menu-${quizId}"[^>]*role="menu"`));
  assert.match(response.text, new RegExp(`href="/admin/quizzes/${quizId}/preview">Preview`));
  assert.match(response.text, new RegExp(`action="/admin/quizzes/${quizId}/archive"`));
  assert.match(response.text, new RegExp(`action="/admin/quizzes/${draftId}/publish"`));
  assert.match(response.text, /<span class="quiz-version">v1<\/span>/);
});

test('archived quiz versions stay out of the main grid and appear in the collapsed archive', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);
  const now = new Date().toISOString();

  // Archive v1 and publish a v2 under the same slug.
  db.prepare("UPDATE quizzes SET status = 'archived' WHERE id = ?").run(seed.quizId);
  db.prepare(
    `INSERT INTO quizzes (slug, version, title, description, status, passing_score_percent,
                          created_at, updated_at, published_at)
     VALUES (?, 2, ?, ?, 'published', 75, ?, ?, ?)`,
  ).run(seed.quizSlug, 'Test quiz', 'The current published version.', now, now, now);

  const response = await request(app).get('/quizzes').set('Cookie', adminAuth.cookie);
  assert.equal(response.status, 200);

  const main = /<ul class="quiz-grid" data-quiz-grid>([\s\S]*?)<\/ul>/.exec(response.text);
  const archive = /<details class="quiz-archive"[\s\S]*?<\/details>/.exec(response.text);
  assert.ok(main, 'the main grid renders');
  assert.ok(archive, 'the archived section renders');

  assert.equal((main[1].match(/data-quiz-slug="phishing-test-quiz"/g) || []).length, 1);
  assert.match(main[1], /data-quiz-status="published"[\s\S]*?data-quiz-slug="phishing-test-quiz"/);
  assert.doesNotMatch(main[1], /data-quiz-status="archived"/);
  assert.match(archive[0], /<summary>[\s\S]*Archived quizzes/);
  assert.match(archive[0], /data-quiz-status="archived"/);
  assert.match(archive[0], /data-quiz-slug="phishing-test-quiz"/);
  assert.match(archive[0], /<span class="quiz-version">v1<\/span>/);
});

test('restoring an archived published version returns it to the live grid', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const seed = seedContent(db);
  const originalPublishedAt = quizRow(db, seed.quizId).published_at;

  const archived = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/archive`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(archived.status, 303, archived.text);
  assert.equal(quizRow(db, seed.quizId).status, 'archived');

  const catalogue = await request(app).get('/quizzes').set('Cookie', adminAuth.cookie);
  const main = /<ul class="quiz-grid" data-quiz-grid>([\s\S]*?)<\/ul>/.exec(catalogue.text);
  const archive = /<details class="quiz-archive"[\s\S]*?<\/details>/.exec(catalogue.text);
  assert.ok(main);
  assert.ok(archive);
  assert.doesNotMatch(main[1], new RegExp(`data-quiz-slug="${seed.quizSlug}"`));
  assert.match(archive[0], new RegExp(`action="/admin/quizzes/${seed.quizId}/restore"`));
  assert.match(archive[0], new RegExp(`action="/admin/quizzes/${seed.quizId}/delete"`));
  assert.match(archive[0], new RegExp(`href="/admin/quizzes/${seed.quizId}/preview"`));
  assert.match(archive[0], /data-quiz-action="restore"/);
  assert.match(archive[0], /data-quiz-action="delete"/);
  assert.match(archive[0], /data-quiz-menu/);
  assert.match(archive[0], /aria-haspopup="menu"/);
  assert.match(archive[0], /data-confirm="/);
  assert.doesNotMatch(archive[0], new RegExp(`href="/admin/quizzes/${seed.quizId}"[^>]*>Edit`));

  const restored = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/restore`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(restored.status, 303, restored.text);
  assert.match(restored.headers.location, /\/quizzes\?notice=quiz_restored/);

  const quiz = quizRow(db, seed.quizId);
  assert.equal(quiz.status, 'published');
  assert.equal(quiz.published_at, originalPublishedAt, 'original publication date is preserved');

  const after = await request(app).get('/quizzes?notice=quiz_restored').set('Cookie', adminAuth.cookie);
  const afterMain = /<ul class="quiz-grid" data-quiz-grid>([\s\S]*?)<\/ul>/.exec(after.text);
  assert.ok(afterMain);
  assert.match(afterMain[1], new RegExp(`data-quiz-status="published"[\\s\\S]*?data-quiz-slug="${seed.quizSlug}"`));
  assert.doesNotMatch(after.text, /data-quiz-archive/);
  assert.match(after.text, /Quiz version restored to the active catalogue/);

  const studentPage = await request(app).get(`/quizzes/${seed.quizSlug}`).set('Cookie', studentAuth.cookie);
  assert.equal(studentPage.status, 200);
});

test('catalogue actions return to the catalogue, detail actions stay in place', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);

  // Archive from the card menu: the admin stays on the catalogue and lands on
  // the Archived view, which is now the only place retired versions appear.
  const archived = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/archive`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, returnTo: '/quizzes?filter=archived#archived' });
  assert.equal(archived.status, 303, archived.text);
  assert.equal(archived.headers.location, '/quizzes?filter=archived&notice=quiz_archived#archived');
  assert.equal(quizRow(db, seed.quizId).status, 'archived');

  const catalogue = await request(app)
    .get('/quizzes?filter=archived&notice=quiz_archived')
    .set('Cookie', adminAuth.cookie);
  assert.match(catalogue.text, /data-quiz-archive open/);
  assert.match(catalogue.text, /data-quiz-filter="archived"[^>]*aria-pressed="true"/);
  assert.match(catalogue.text, /name="returnTo"/);

  // The default "All" view still keeps the collapsed archive at the bottom.
  const allView = await request(app).get('/quizzes').set('Cookie', adminAuth.cookie);
  assert.match(allView.text, /data-quiz-filter="all"[^>]*aria-pressed="true"/);
  assert.match(allView.text, /data-quiz-archive/);
  assert.match(allView.text, /Archived quizzes/);
  assert.doesNotMatch(allView.text, /data-quiz-archive open/, 'the archive starts collapsed under All');

  // Restore sends the quiz back to the live catalogue.
  const restored = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/restore`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, returnTo: '/quizzes' });
  assert.equal(restored.status, 303, restored.text);
  assert.equal(restored.headers.location, '/quizzes?notice=quiz_restored');
  assert.equal(quizRow(db, seed.quizId).status, 'published');

  // Archiving from the detail page (no returnTo) keeps the old in-place jump.
  const inPlace = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/archive`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(inPlace.status, 303);
  assert.equal(inPlace.headers.location, `/admin/quizzes/${seed.quizId}?notice=quiz_archived`);

  // Only local paths are honoured; anything else falls back to the default.
  for (const hostile of ['//evil.example/x', 'https://evil.example/x', '/\\evil.example', '/..%2fevil', 'evil']) {
    const blocked = await request(app)
      .post(`/admin/quizzes/${seed.quizId}/archive`)
      .set('Cookie', adminAuth.cookie)
      .send({ _csrf: adminAuth.csrfToken, returnTo: hostile });
    assert.equal(blocked.status, 303, `${hostile} should still redirect`);
    assert.equal(
      blocked.headers.location,
      `/admin/quizzes/${seed.quizId}?notice=quiz_archived`,
      `${hostile} must be ignored`,
    );
    assert.doesNotMatch(blocked.headers.location, /evil/);
  }

  // Publishing from the card menu also stays on the catalogue.
  const draft = db.prepare("SELECT id FROM quizzes WHERE slug = 'draft-quiz'").get();
  await request(app)
    .post(`/admin/quizzes/${draft.id}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'Which password is strongest?',
      q_0_opt_0: 'A long unique passphrase',
      q_0_opt_1: 'Your birthday',
      q_0_opt_2: 'password123',
      q_0_opt_3: 'The site name',
      q_0_correct: '0',
    });
  const published = await request(app)
    .post(`/admin/quizzes/${draft.id}/publish`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, returnTo: '/quizzes' });
  assert.equal(published.status, 303, published.text);
  assert.equal(published.headers.location, '/quizzes?notice=quiz_published');
  assert.equal(quizRow(db, draft.id).status, 'published');

  // Helper behaviour: query strings survive, the fragment stays last.
  const { safeReturnPath, withNotice } = require('../src/validation');
  assert.equal(safeReturnPath('/quizzes?page=2#archived', '/x'), '/quizzes?page=2#archived');
  assert.equal(safeReturnPath('javascript:alert(1)', '/x'), '/x');
  assert.equal(safeReturnPath(undefined, '/x'), '/x');
  assert.equal(withNotice('/quizzes?f=1#archived', 'quiz_archived'), '/quizzes?f=1&notice=quiz_archived#archived');
});

test('restoring an archived draft returns it to draft', async () => {
  const { app, db, adminAuth } = setupRoles();
  seedContent(db);
  const draft = db.prepare("SELECT id, published_at FROM quizzes WHERE slug = 'draft-quiz'").get();
  assert.equal(draft.published_at, null);

  const archived = await request(app)
    .post(`/admin/quizzes/${draft.id}/archive`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(archived.status, 303);
  assert.equal(quizRow(db, draft.id).status, 'archived');

  const restored = await request(app)
    .post(`/admin/quizzes/${draft.id}/restore`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(restored.status, 303);
  assert.match(restored.headers.location, /notice=quiz_restored/);
  assert.equal(quizRow(db, draft.id).status, 'draft');

  const catalogue = await request(app).get('/quizzes').set('Cookie', adminAuth.cookie);
  assert.match(catalogue.text, /data-quiz-status="draft"[\s\S]*?data-quiz-slug="draft-quiz"/);
});

test('archived versions with no attempts can be deleted safely', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);
  const questionIds = db
    .prepare('SELECT id FROM quiz_questions WHERE quiz_id = ?')
    .all(seed.quizId)
    .map((row) => row.id);
  assert.equal(questionIds.length, 1);

  await request(app)
    .post(`/admin/quizzes/${seed.quizId}/archive`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(quizRow(db, seed.quizId).status, 'archived');

  const noCsrf = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/delete`)
    .set('Cookie', adminAuth.cookie);
  assert.equal(noCsrf.status, 403, 'deletion requires a CSRF token');
  assert.equal(quizRow(db, seed.quizId).status, 'archived');

  const deleted = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/delete`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(deleted.status, 303, deleted.text);
  assert.match(deleted.headers.location, /\/quizzes\?notice=quiz_deleted/);

  assert.equal(quizRow(db, seed.quizId), undefined, 'quiz row removed');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?').get(seed.quizId).n,
    0,
    'questions removed',
  );
  const remainingOptions = db
    .prepare('SELECT COUNT(*) AS n FROM quiz_options WHERE question_id = ?')
    .get(questionIds[0]).n;
  assert.equal(remainingOptions, 0, 'options removed');

  const catalogue = await request(app).get('/quizzes?notice=quiz_deleted').set('Cookie', adminAuth.cookie);
  assert.doesNotMatch(catalogue.text, new RegExp(`data-quiz-slug="${seed.quizSlug}"`));
  assert.match(catalogue.text, /Archived quiz version deleted/);
});

test('archived versions with student attempts cannot be deleted', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);
  const now = new Date().toISOString();
  const attempt = db
    .prepare(
      `INSERT INTO quiz_attempts (user_id, quiz_id, status, score_points, max_points, started_at, submitted_at)
       VALUES ((SELECT id FROM users WHERE email = 'student@example.test'), ?, 'submitted', 1, 1, ?, ?)`,
    )
    .run(seed.quizId, now, now);

  await request(app)
    .post(`/admin/quizzes/${seed.quizId}/archive`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });

  const denied = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/delete`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(denied.status, 303, denied.text);
  assert.match(denied.headers.location, /error=quiz_has_attempts/);

  assert.equal(quizRow(db, seed.quizId).status, 'archived', 'quiz stays archived');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM quiz_attempts WHERE quiz_id = ?').get(seed.quizId).n,
    1,
    'attempt history stays intact',
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?').get(seed.quizId).n,
    1,
    'questions stay intact',
  );

  // The archived version can still be restored to published without touching
  // the attempt that is pinned to it.
  const restored = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/restore`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(restored.status, 303);
  assert.equal(quizRow(db, seed.quizId).status, 'published');
  assert.equal(db.prepare('SELECT status FROM quiz_attempts WHERE id = ?').get(attempt.lastInsertRowid).status, 'submitted');
});

test('restore and delete reject versions that are not archived', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);
  const draftId = db.prepare("SELECT id FROM quizzes WHERE slug = 'draft-quiz'").get().id;

  const restorePublished = await request(app)
    .post(`/admin/quizzes/${seed.quizId}/restore`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(restorePublished.status, 303);
  assert.match(restorePublished.headers.location, /error=quiz_not_archived/);

  const deleteDraft = await request(app)
    .post(`/admin/quizzes/${draftId}/delete`)
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken });
  assert.equal(deleteDraft.status, 303);
  assert.match(deleteDraft.headers.location, /error=quiz_not_archived/);
  assert.equal(quizRow(db, seed.quizId).status, 'published');
  assert.equal(quizRow(db, draftId).status, 'draft');
});

test('a published quiz version is immutable: no in-place edits, no direct SQL', async () => {
  const { app, db, adminAuth, config } = setupRoles();
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
      q_0_opt_2: 'C',
      q_0_opt_3: 'D',
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
      q_0_opt_2: 'Third option',
      q_0_opt_3: 'Fourth option',
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
  assert.match(list.text, /Test quiz/);

  // Admin detail shows selected + correct answers, explanations, read-only note.
  const detail = await request(app).get(`/admin/attempts/${attemptId}`).set('Cookie', adminAuth.cookie);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /A deadline plus a login link/); // correct answer shown
  assert.match(detail.text, /correct/i);
  assert.match(detail.text, /Urgency plus a link is a classic sign\./); // explanation
  assert.match(detail.text, /Read-only|cannot be edited/i);
  // The review renders the same question cards as the student result page,
  // with every option row (not just the selected/correct labels).
  assert.match(detail.text, /class="option-row"/);
  assert.match(detail.text, /<span class="option-text">A deadline plus a login link<\/span>/);
  assert.match(detail.text, /<span class="option-text">A logo<\/span>/);
  assert.match(detail.text, /chip chip-pass">Correct</);

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
  assert.match(response.text, /ACTIVE USERS/);
  assert.match(response.text, /PUBLISHED MODULES/);
  assert.match(response.text, /PUBLISHED QUIZZES/);
  assert.match(response.text, /AVERAGE SCORE/);
  assert.match(response.text, /100%/, 'average score of the perfect attempt');
});

// ---------------------------------------------------------------------------
// 7. Shared admin tab row: present on every page, one active section
// ---------------------------------------------------------------------------

const TAB_PAGES = [
  ['/admin/attempts', '/admin/attempts'],
];

/** The shared tab row markup, or null when the page does not render one. */
function adminTabRow(html) {
  const match = /<nav class="filter-bar" aria-label="Admin sections">([\s\S]*?)<\/nav>/.exec(html);
  return match ? match[1] : null;
}

test('the dashboard header carries quick actions', async () => {
  const { app, adminAuth } = setupRoles();

  const response = await request(app).get('/admin').set('Cookie', adminAuth.cookie);

  assert.equal(response.status, 200);

  const head = /<header class="page-head">([\s\S]*?)<\/header>/.exec(response.text);
  assert.ok(head, 'the dashboard keeps its page header');
  assert.ok(!head[1].includes('+ New module'), 'no new module quick action');
  assert.ok(!head[1].includes('+ New quiz'), 'no new quiz quick action');
});

test('last admin dashboard stats', async () => {
  const { app, db, adminAuth, config } = setupRoles();
  const user = createUser(db, {email:'last@example.test', username:'last1', displayName:'Last User'});
  const auth = login(db, config, user);
  const page = await request(app).get('/admin').set('Cookie', adminAuth.cookie);
  assert.equal(page.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users WHERE role=?').get('admin').c, 1);
  void auth;
});

test('question saving drops empty option slots and the preview letters them A-D', async () => {
  const { app, db, adminAuth } = setupRoles();

  const create = await request(app)
    .post('/admin/quizzes')
    .set('Cookie', adminAuth.cookie)
    .send({ _csrf: adminAuth.csrfToken, title: 'Preview lettering quiz' });
  assert.equal(create.status, 303, create.text);
  const id = Number(/\/admin\/quizzes\/(\d+)/.exec(create.headers.location)[1]);

  // The editor always renders six slots; the two extra ones are submitted blank.
  const saved = await request(app)
    .post(`/admin/quizzes/${id}/questions`)
    .set('Cookie', adminAuth.cookie)
    .send({
      _csrf: adminAuth.csrfToken,
      q_0_prompt: 'Which option is correct?',
      q_0_explanation: 'Gamma is the answer.',
      q_0_opt_0: 'Alpha',
      q_0_opt_1: 'Beta',
      q_0_opt_2: 'Gamma',
      q_0_opt_3: 'Delta',
      q_0_opt_4: '',
      q_0_opt_5: '',
      q_0_correct: '2',
    });
  assert.equal(saved.status, 303, saved.text);

  const options = db
    .prepare(
      `SELECT o.label, o.is_correct AS isCorrect
         FROM quiz_options o
         JOIN quiz_questions q ON q.id = o.question_id
        WHERE q.quiz_id = ?
        ORDER BY o.position`,
    )
    .all(id);
  assert.deepEqual(options.map((option) => option.label), ['Alpha', 'Beta', 'Gamma', 'Delta']);
  assert.equal(options.filter((option) => option.isCorrect === 1).length, 1, 'exactly one correct');
  assert.equal(options[2].isCorrect, 1, 'the correct slot is preserved after dropping blanks');

  const preview = await request(app).get(`/admin/quizzes/${id}/preview`).set('Cookie', adminAuth.cookie);
  assert.equal(preview.status, 200);
  assert.equal((preview.text.match(/option-row option-row-static/g) || []).length, 4, 'four choice rows');
  assert.match(preview.text, /option-letter"[^>]*>A</);
  assert.match(preview.text, /option-letter"[^>]*>B</);
  assert.match(preview.text, /option-letter"[^>]*>C</);
  assert.match(preview.text, /option-letter"[^>]*>D</);
  assert.doesNotMatch(preview.text, /option-marker/, 'old bullet markup is gone');
  assert.doesNotMatch(preview.text, /class="question-list"/, 'no double numbering list');
});

test('a module can be created with its first handout in one submit', async () => {
  const { app, db, adminAuth } = setupRoles();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  const response = await request(app)
    .post('/admin/modules')
    .set('Cookie', adminAuth.cookie)
    .field('_csrf', adminAuth.csrfToken)
    .field('title', 'Phishing awareness')
    .field('description', 'One handout to start with.')
    .field('status', 'published')
    .field('item_title', 'Phishing handout')
    .attach('file', pdf, { filename: 'phishing.pdf', contentType: 'application/pdf' });

  assert.equal(response.status, 303, response.text);
  assert.equal(response.headers.location, '/modules?notice=module_created_with_file');

  // The admin lands back on the module list, so find the row by title.
  const mod = db.prepare('SELECT * FROM modules WHERE title = ?').get('Phishing awareness');
  const moduleId = mod.id;
  assert.equal(mod.title, 'Phishing awareness');
  assert.equal(mod.status, 'published', 'status chosen in the form is applied');

  // The list confirms the creation and shows the new module.
  const listPage = await request(app)
    .get('/modules?notice=module_created_with_file')
    .set('Cookie', adminAuth.cookie);
  assert.match(listPage.text, /first handout attached/);
  assert.match(listPage.text, /Phishing awareness/);

  const item = db.prepare('SELECT * FROM module_items WHERE module_id = ?').get(moduleId);
  assert.equal(item.type, 'file');
  assert.equal(item.title, 'Phishing handout');
  assert.equal(item.file_name, 'phishing.pdf');

  const fs = require('node:fs');
  const path = require('node:path');
  fs.rmSync(path.join(process.cwd(), 'data', item.file_path), { force: true });

  // The new-module page already offers the upload fields.
  const newPage = await request(app).get('/admin/modules/new').set('Cookie', adminAuth.cookie);
  assert.match(newPage.text, /enctype="multipart\/form-data"/);
  assert.match(newPage.text, /name="item_title"/);
  assert.match(newPage.text, /name="file"/);

  // The edit page has one status control and a clearly separated delete action.
  const editPage = await request(app).get(`/admin/modules/${moduleId}`).set('Cookie', adminAuth.cookie);
  assert.match(editPage.text, /name="status"/);
  assert.doesNotMatch(editPage.text, /action="\/admin\/modules\/\d+\/publish"/, 'no duplicate publish button');
  assert.doesNotMatch(editPage.text, /action="\/admin\/modules\/\d+\/hide"/, 'no duplicate hide button');
  assert.match(editPage.text, /action="\/admin\/modules\/\d+\/delete"/);
});

test('module form errors stay visible after the redirect', async () => {
  const { app, adminAuth } = setupRoles();

  const post = await request(app)
    .post('/admin/modules')
    .set('Cookie', adminAuth.cookie)
    .field('_csrf', adminAuth.csrfToken)
    .field('title', '')
    .field('status', 'draft');
  assert.equal(post.status, 303);
  assert.match(post.headers.location, /error=module_title_required$/);

  // The browser follows the redirect, so the message is on that URL.
  const page = await request(app).get(post.headers.location).set('Cookie', adminAuth.cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /Enter a module title/);
});

test('a draft module previews for admins but is not found for students', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const modulesDb = require('../src/db/modules');
  const draft = modulesDb.createModule(db, { title: 'Draft preview module', description: '', status: 'draft' });

  // Students get a 404 page; this used to surface as a 500.
  const asStudent = await request(app).get(`/modules/${draft.id}`).set('Cookie', studentAuth.cookie);
  assert.equal(asStudent.status, 404);
  assert.match(asStudent.text, /not found/i);
  assert.doesNotMatch(asStudent.text, /Something went wrong/);

  // Admins can open it, clearly marked as a preview.
  const asAdmin = await request(app).get(`/modules/${draft.id}`).set('Cookie', adminAuth.cookie);
  assert.equal(asAdmin.status, 200);
  assert.match(asAdmin.text, /Draft preview/);
  assert.match(asAdmin.text, /Draft preview module/);

  const missing = await request(app).get('/modules/99999').set('Cookie', adminAuth.cookie);
  assert.equal(missing.status, 404);
});

test('module pages render their markdown safely', async () => {
  const { app, db, studentAuth } = setupRoles();
  const seed = seedContent(db);

  const page = await request(app).get(`/modules/${seed.moduleId}`).set('Cookie', studentAuth.cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /<h2>Heading<\/h2>/, 'markdown heading is rendered');
  assert.match(page.text, /<strong>bold<\/strong>/, 'inline markdown is rendered');
  assert.doesNotMatch(page.text, /## Heading/, 'no raw markdown leaks to students');
  assert.doesNotMatch(page.text, /<script>alert\(1\)<\/script>/, 'stored HTML is escaped');
});

test('draft module files open for admins and stay closed for students', async () => {
  const { app, db, adminAuth, studentAuth } = setupRoles();
  const modulesDb = require('../src/db/modules');
  const fs = require('node:fs');
  const path = require('node:path');

  const name = `audit-${Date.now()}.pdf`;
  const filePath = path.join(process.cwd(), 'data', 'uploads', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\n%%EOF\n'));

  const draft = modulesDb.createModule(db, { title: 'Draft file module', status: 'draft' });
  modulesDb.addItem(db, {
    moduleId: draft.id,
    type: 'file',
    title: 'Handout',
    filePath: 'uploads/' + name,
    fileName: 'handout "quoted" name.pdf',
    fileSize: 16,
  });

  const asAdmin = await request(app).get(`/files/${name}`).set('Cookie', adminAuth.cookie);
  assert.equal(asAdmin.status, 200, 'admins can preview files of unpublished modules');
  assert.match(asAdmin.headers['content-disposition'], /filename\*=UTF-8''/);

  const asStudent = await request(app).get(`/files/${name}`).set('Cookie', studentAuth.cookie);
  assert.equal(asStudent.status, 403);

  fs.rmSync(filePath, { force: true });
});

test('rejected uploads show a message instead of a 500 page', async () => {
  const { app, db, adminAuth } = setupRoles();
  const seed = seedContent(db);

  const moduleUpload = await request(app)
    .post(`/admin/modules/${seed.moduleId}/items/upload`)
    .set('Cookie', adminAuth.cookie)
    .field('_csrf', adminAuth.csrfToken)
    .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
  assert.equal(moduleUpload.status, 303, moduleUpload.text);
  assert.match(moduleUpload.headers.location, /error=upload_failed$/);

  const avatar = await request(app)
    .post('/settings/profile/photo')
    .set('Cookie', adminAuth.cookie)
    .field('_csrf', adminAuth.csrfToken)
    .attach('avatar', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
  assert.equal(avatar.status, 303, avatar.text);
  assert.equal(avatar.headers.location, '/settings/profile');
});

test('admin actions leave a visible confirmation across the redirect', async () => {
  const { app, db, adminAuth } = setupRoles();
  const student = createUser(db, { email: 'flash.student@example.test', username: 'flashstudent' });

  const post = await request(app)
    .post(`/admin/users/${student.id}/disable`)
    .set('Cookie', adminAuth.cookie)
    .type('form')
    .send({ _csrf: adminAuth.csrfToken, _confirm: '1' });
  assert.equal(post.status, 303, post.text);

  const flashCookie = (post.headers['set-cookie'] || [])
    .map((cookie) => cookie.split(';')[0])
    .find((cookie) => cookie.startsWith('cybersafe.flash='));
  assert.ok(flashCookie, 'the message travels in a short-lived cookie');

  const page = await request(app)
    .get('/admin/users')
    .set('Cookie', `${adminAuth.cookie}; ${flashCookie}`);
  assert.match(page.text, /disabled\./, 'the confirmation is rendered');

  const clearing = (page.headers['set-cookie'] || [])
    .map((cookie) => cookie.split(';')[0])
    .filter((cookie) => cookie.startsWith('cybersafe.flash='));
  assert.ok(clearing.some((cookie) => cookie.endsWith('cybersafe.flash=')), 'the cookie is cleared after use');
});

test('draft modules sink to the bottom of the module list for admins', async () => {
  const { app, db, adminAuth } = setupRoles();
  const modulesDb = require('../src/db/modules');
  seedContent(db); // published "Test module"
  modulesDb.createModule(db, { title: 'Zzz hidden module', status: 'hidden' });
  modulesDb.createModule(db, { title: 'Zzz draft module', status: 'draft' });

  const page = await request(app).get('/modules').set('Cookie', adminAuth.cookie);
  assert.equal(page.status, 200);
  const order = [...page.text.matchAll(/class="module-row-title">([^<]+)</g)].map((match) => match[1]);
  assert.deepEqual(order, ['Test module', 'Zzz hidden module', 'Zzz draft module']);
});
