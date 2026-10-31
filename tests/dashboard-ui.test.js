'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

async function signedInDashboard(overrides) {
  const ctx = createContext(overrides || {});
  const user = createUser(ctx.db, { email: 'ui.student@example.test', username: 'uistudent', displayName: 'Uma Ito' });
  const auth = login(ctx.db, ctx.config, user);
  return { ctx, user, auth };
}

test('the dashboard renders the dark app shell with three icon stat cards', async () => {
  const { ctx, auth } = await signedInDashboard();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.equal(response.status, 200);
  assert.match(response.text, /class="page-app"/);

  const cards = response.text.match(/class="stat-card stat-card--[a-z]+"/g) || [];
  assert.equal(cards.length, 3, 'three stat cards');
  const iconCount = (response.text.match(/class="stat-icon"[\s\S]{0,200}?<svg/g) || []).length;
  assert.equal(iconCount, 3, 'each stat card renders an inline svg icon');

  assert.match(response.text, /0<span class="stat-suffix">\/0<\/span>/);
});

test('the continue card is a hero with a module title and CTA', async () => {
  const { ctx, auth } = await signedInDashboard();
  seedContent(ctx.db);
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.equal(response.status, 200);
  assert.match(response.text, /class="continue-hero"/);
  assert.match(response.text, /class="tag-pill"/);
  assert.match(response.text, /class="btn btn-primary btn-hero" href="\/modules\/\d+"/);
  assert.match(response.text, /Continue/);
});

test('your modules list shows progress bars linking to /modules/:id', async () => {
  const { ctx, auth } = await signedInDashboard();
  const seed = seedContent(ctx.db);
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  const rows = response.text.match(/class="module-row"/g) || [];
  assert.equal(rows.length, 1, 'one row per published module');
  assert.match(response.text, /class="meter meter--sm"/);
  assert.match(response.text, /href="\/modules\/\d+"/);

  await request(ctx.app)
    .post(`/modules/${seed.moduleId}/items/${seed.itemId}/complete`)
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });
  const after = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);
  assert.match(after.text, /100%/);
});

test('the nav shows an avatar with the user initials', async () => {
  const { ctx, auth } = await signedInDashboard();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.match(response.text, /class="nav-avatar"[\s\S]*?aria-hidden="true">UI</);
  assert.match(response.text, /Account menu for Uma Ito/);
});

test('the empty quiz state uses the secure illustration', async () => {
  const { ctx, auth } = await signedInDashboard();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.match(response.text, /class="empty-illustration"/);
  assert.match(response.text, /No quiz attempts yet/);
});

test('the dashboard never shows development artefacts', async () => {
  const { ctx, auth } = await signedInDashboard();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  for (const fragment of ['Development mode', 'AUTH_DEV_MODE', 'Local development sign-in', 'Sign in for development']) {
    assert.ok(!response.text.includes(fragment), 'dashboard must not contain: ' + fragment);
  }
});