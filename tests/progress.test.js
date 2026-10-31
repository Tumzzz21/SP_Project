'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

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