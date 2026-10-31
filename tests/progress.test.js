'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');
const modulesDb = require('../src/db/modules');

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

test('module completion requires a valid CSRF token', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const seed = seedContent(db);

  // no token -> 403
  const noToken = await request(app)
    .post(`/modules/${seed.moduleId}/items/${seed.itemId}/complete`)
    .set('Cookie', auth.cookie)
    .send({});
  assert.equal(noToken.status, 403);

  // wrong token -> 403
  const wrong = await request(app)
    .post(`/modules/${seed.moduleId}/items/${seed.itemId}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: 'wrong-token' });
  assert.equal(wrong.status, 403);

  // valid token -> success
  const ok = await request(app)
    .post(`/modules/${seed.moduleId}/items/${seed.itemId}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(ok.status, 303);

  // idempotent: second call succeeds
  const again = await request(app)
    .post(`/modules/${seed.moduleId}/items/${seed.itemId}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.equal(again.status, 303);
});

test('a student cannot complete an item in a draft or hidden module', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const now = new Date().toISOString();
  const mod = db.prepare(
    `INSERT INTO modules (title, description, status, sort_order, require_sequential, created_at, updated_at, published_at)
     VALUES (?, ?, ?, 0, 0, ?, ?, NULL)`,
  ).run('Draft module', 'hidden', 'draft', now, now);
  const moduleId = Number(mod.lastInsertRowid);
  const item = modulesDb.addItem(db, { moduleId, type: 'page', title: 'Draft item', content: 'Body', sortOrder: 0 });

  const res = await request(app)
    .post(`/modules/${moduleId}/items/${item.id}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  assert.ok(res.status === 404 || res.status === 403, 'draft module completion must be rejected');
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