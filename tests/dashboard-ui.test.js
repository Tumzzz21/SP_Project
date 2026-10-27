'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');
const lessonsDb = require('../src/db/lessons');

async function signedInDashboard(overrides) {
  const ctx = createContext(overrides || {});
  const user = createUser(ctx.db, { email: 'ui.student@example.test', username: 'uistudent', displayName: 'Uma Ito' });
  const auth = login(ctx.db, ctx.config, user);
  return { ctx, user, auth };
}

test('the dashboard renders the dark app shell with four icon stat cards', async () => {
  const { ctx, auth } = await signedInDashboard();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.equal(response.status, 200);
  assert.match(response.text, /class="page-app"/);

  // every stat card carries an inline SVG icon and an accent colour class
  const cards = response.text.match(/class="stat-card stat-card--[a-z]+"/g) || [];
  assert.equal(cards.length, 4);
  const iconCount = (response.text.match(/class="stat-icon"[\s\S]{0,200}?<svg/g) || []).length;
  assert.equal(iconCount, 4, 'each stat card renders an inline svg icon');

  // the pinned stat markup stays intact
  assert.match(response.text, /0<span class="stat-suffix">\/0<\/span>/);
});

test('the continue banner is a hero with a category pill, read time and CTA', async () => {
  const { ctx, auth } = await signedInDashboard();
  seedContent(ctx.db);
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.equal(response.status, 200);
  assert.match(response.text, /class="continue-hero"/);
  assert.match(response.text, /class="tag-pill tag-pill--[a-z]+"/);
  assert.match(response.text, /class="read-time"/);
  assert.match(response.text, /min read/);
  assert.match(response.text, /class="btn btn-primary btn-hero" href="\/learn\/[^"]+"/);
  assert.match(response.text, /Continue lesson/);
});

test('topic tracks list every category with an icon and a completion badge', async () => {
  const { ctx, user, auth } = await signedInDashboard();
  seedContent(ctx.db);
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  const rows = response.text.match(/class="track-row"/g) || [];
  assert.equal(rows.length, 5, 'one row per topic track');
  const trackIcons = (response.text.match(/class="track-icon track-icon--[a-z]+"/g) || []).length;
  assert.equal(trackIcons, 5);
  assert.ok((response.text.match(/class="track-badge track-badge--[a-z]+"/g) || []).length >= 5);

  // completing the only published lesson flips its track to a completed badge
  const published = lessonsDb.listPublished(ctx.db);
  assert.ok(published.length > 0);
  lessonsDb.markCompleted(ctx.db, user.id, published[0].id);
  const after = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);
  assert.match(after.text, /track-badge--done/);
  assert.match(after.text, /1\/1 completed/);
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
