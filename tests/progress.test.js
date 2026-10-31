'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

function progressRows(db, userId) {
  return db.prepare('SELECT * FROM lesson_progress WHERE user_id = ?').all(userId);
}

test('lesson completion persists, is idempotent, and stays per student', async () => {
  const { app, db, config } = createContext();
  const ana = createUser(db, { email: 'ana@example.test', username: 'ana1' });
  const ben = createUser(db, { email: 'ben@example.test', username: 'ben1' });
  const anaAuth = login(db, config, ana);
  const benAuth = login(db, config, ben);
  const { lessonSlug } = seedContent(db);

  const first = await request(app)
    .post(`/learn/${lessonSlug}/complete`)
    .set('Cookie', anaAuth.cookie)
    .send({ _csrf: anaAuth.csrfToken });
  assert.equal(first.status, 303);
  assert.match(first.headers.location, /notice=lesson_completed/);

  const rows = progressRows(db, ana.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'completed');
  const completedAt = rows[0].completed_at;
  assert.ok(completedAt);

  // Repeating the request is safe and keeps the original timestamp.
  const repeat = await request(app)
    .post(`/learn/${lessonSlug}/complete`)
    .set('Cookie', anaAuth.cookie)
    .send({ _csrf: anaAuth.csrfToken });
  assert.equal(repeat.status, 303);
  const afterRepeat = progressRows(db, ana.id);
  assert.equal(afterRepeat.length, 1, 'no duplicate progress row');
  assert.equal(afterRepeat[0].completed_at, completedAt, 'completion time is not rewritten');

  // The other student sees none of it.
  assert.equal(progressRows(db, ben.id).length, 0);
  const benLearn = await request(app).get('/learn').set('Cookie', benAuth.cookie);
  assert.equal(benLearn.status, 303);
});

test('dashboard shows module progress from real records', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const seed = seedContent(db);

  await request(app)
    .post(`/modules/${seed.moduleId}/items/${seed.itemId}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /1<span class="stat-suffix">\/1<\/span>/);
  assert.match(dashboard.text, /100<span class="stat-suffix">%<\/span>/);

  const learn = await request(app).get('/learn').set('Cookie', auth.cookie);
  assert.equal(learn.status, 303);
});

test('a lesson can be marked incomplete again', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const { lessonSlug } = seedContent(db);

  await request(app)
    .post(`/learn/${lessonSlug}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(progressRows(db, user.id).length, 1);

  const undo = await request(app)
    .post(`/learn/${lessonSlug}/reopen`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(undo.status, 303);
  assert.match(undo.headers.location, /notice=lesson_reopened/);
  assert.equal(progressRows(db, user.id).length, 0);

  const page = await request(app).get(`/learn/${lessonSlug}`).set('Cookie', auth.cookie);
  assert.equal(page.status, 303);
});

test('unpublished lessons cannot be completed or opened', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO lessons (slug, title, summary, category, content, reading_minutes, status, created_at, updated_at, published_at)
     VALUES ('draft-lesson', 'Draft lesson', 'Hidden', 'phishing', 'Body', 3, 'draft', ?, ?, NULL)`,
  ).run(now, now);

  const complete = await request(app)
    .post('/learn/draft-lesson/complete')
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(complete.status, 404);
  assert.equal(progressRows(db, user.id).length, 0);

  const page = await request(app).get('/learn/draft-lesson').set('Cookie', auth.cookie);
  assert.equal(page.status, 404);
});

test('administrators cannot record lesson progress', async () => {
  const { app, db, config } = createContext();
  const admin = createUser(db, { username: 'boss', role: 'admin' });
  const auth = login(db, config, admin);
  const { lessonSlug } = seedContent(db);

  const response = await request(app)
    .post(`/learn/${lessonSlug}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(response.status, 403);
  assert.equal(progressRows(db, admin.id).length, 0);
});

test('lesson completion requires a session and a CSRF token', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const { lessonSlug } = seedContent(db);

  const anonymous = await request(app).post(`/learn/${lessonSlug}/complete`).send({});
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.headers.location, /^\/login/);

  const noToken = await request(app)
    .post(`/learn/${lessonSlug}/complete`)
    .set('Cookie', auth.cookie)
    .send({});
  assert.equal(noToken.status, 403);
  assert.equal(progressRows(db, user.id).length, 0);
});

test('empty progress renders explicit empty states instead of fake numbers', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /No modules are published yet/);
  assert.match(dashboard.text, /No quiz attempts yet/);
  assert.match(dashboard.text, /0<span class="stat-suffix">\/0<\/span>/);

  const learn = await request(app).get('/learn').set('Cookie', auth.cookie);
  assert.equal(learn.status, 303);
});
