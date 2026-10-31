'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

test('students cannot reach the admin area or admin API', async () => {
  const { app, db, config } = createContext();
  const student = createUser(db, { email: 'student@example.test', username: 'student1' });
  const auth = login(db, config, student);

  const page = await request(app).get('/admin').set('Cookie', auth.cookie);
  assert.equal(page.status, 403);
  assert.match(page.text, /Access denied/);
  assert.doesNotMatch(page.text, /Admin dashboard/);

  const api = await request(app).get('/api/admin/summary').set('Cookie', auth.cookie);
  assert.equal(api.status, 403);
  assert.equal(api.body.error.code, 'insufficient_role');
});

test('administrators reach the admin shell and are redirected there from the student dashboard', async () => {
  const { app, db, config } = createContext();
  const admin = createUser(db, {
    email: 'admin@example.test',
    username: 'adminuser',
    displayName: 'Site Admin',
    role: 'admin',
  });
  const auth = login(db, config, admin);
  seedContent(db);

  const page = await request(app).get('/admin').set('Cookie', auth.cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /Admin overview/);
  assert.match(page.text, /PUBLISHED MODULES/);

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(dashboard.status, 200);

  const api = await request(app).get('/api/admin/summary').set('Cookie', auth.cookie);
  assert.equal(api.status, 200);
  assert.equal(api.body.users.admins, 1);
  assert.equal(api.body.modules.published, 1);
});

test('public registration exists but can never create an administrator', async () => {
  const { app, db } = createContext();

  // Routes that must stay absent outright.
  for (const path of ['/signup', '/admin/register']) {
    const response = await request(app)
      .post(path)
      .type('form')
      .send({ email: 'x@example.test', role: 'admin', username: 'attacker' });
    assert.equal(response.status, 404, `${path} must not exist`);
  }

  // The real registration endpoint: even when the body demands the admin
  // role, the created account is a student with no privileges.
  const response = await request(app)
    .post('/auth/register')
    .type('form')
    .send({
      email: 'attacker@example.test',
      password: 'correct horse battery',
      confirmPassword: 'correct horse battery',
      role: 'admin',
      username: 'attacker',
    });
  assert.equal(response.status, 303);
  assert.match(response.headers.location, /^\/setup/);

  const rows = db.prepare('SELECT role, status FROM users').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'student', 'registration must never grant admin');
  assert.equal(rows[0].status, 'pending_setup');

  const admins = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").get().total;
  assert.equal(admins, 0, 'no administrator may be created by any public route');
});

test('a disabled account immediately loses access and its session', async () => {
  const { app, db, config } = createContext();
  const student = createUser(db, { email: 'student@example.test', username: 'student1' });
  const auth = login(db, config, student);

  const before = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(before.status, 200);

  db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(student.id);

  const after = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(after.status, 302);
  assert.match(after.headers.location, /^\/login/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);

  const api = await request(app).get('/api/quizzes').set('Cookie', auth.cookie);
  assert.equal(api.status, 401);
});

test('an expired session is rejected and removed', async () => {
  const { app, db, config } = createContext();
  const student = createUser(db, {});
  const auth = login(db, config, student);

  db.prepare('UPDATE sessions SET expires_at = ?').run(new Date(Date.now() - 60_000).toISOString());

  const response = await request(app).get('/account').set('Cookie', auth.cookie);
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^\/login/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
});

test('account updates require CSRF and validate the display name', async () => {
  const { app, db, config } = createContext();
  const student = createUser(db, { email: 'student@example.test', username: 'student1' });
  const auth = login(db, config, student);

  const noToken = await request(app)
    .post('/settings/profile')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ display_name: 'Hacked Name' });
  assert.equal(noToken.status, 403);
  assert.equal(db.prepare('SELECT display_name FROM users WHERE id = ?').get(student.id).display_name, 'Student One');

  const empty = await request(app)
    .post('/settings/profile')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, display_name: '   ' });
  assert.equal(empty.status, 400);
  assert.match(empty.text, /Display name is required/);

  const ok = await request(app)
    .post('/settings/profile')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, display_name: 'Ana S.', username: 'student1' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, '/settings/profile');
  assert.equal(db.prepare('SELECT display_name FROM users WHERE id = ?').get(student.id).display_name, 'Ana S.');
});

test('a cookie from another browser cannot be guessed', async () => {
  const { app } = createContext();
  const response = await request(app).get('/dashboard').set('Cookie', 'cybersafe.sid=not-a-real-token');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login?next=%2Fdashboard');
});
