'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

test('the root path redirects unauthenticated visitors to sign in', async () => {
  const { app } = createContext();
  const response = await request(app).get('/');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login');
});

test('the health endpoint reports readiness without secrets', async () => {
  const { app } = createContext();
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.deepEqual(Object.keys(response.body).sort(), ['service', 'status', 'time']);
});

test('unknown pages render a 404 page with navigation', async () => {
  const { app } = createContext();
  const response = await request(app).get('/this-page-does-not-exist');
  assert.equal(response.status, 404);
  assert.match(response.text, /Page not found/);
  assert.match(response.text, /Go to the home page/);
});

test('protected pages redirect to sign-in and keep a safe return path', async () => {
  const { app } = createContext();
  const response = await request(app).get('/account');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login?next=%2Faccount');
});

test('an absolute redirect target is never trusted', async () => {
  const { app } = createContext();
  const response = await request(app).get('/login?next=https%3A%2F%2Fevil.example');
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.text, /evil\.example/);
});

test('API endpoints answer 401 with JSON, not an HTML page', async () => {
  const { app } = createContext();
  const response = await request(app).get('/api/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'sign_in_required');
});

test('security headers include a restrictive content security policy', async () => {
  const { app } = createContext();
  const response = await request(app).get('/');
  const csp = response.headers['content-security-policy'];
  assert.ok(csp, 'CSP header is required');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['x-request-id'], 'request id is exposed for support');
});

test('authenticated pages are not cacheable', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const response = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.headers['cache-control'], /no-store/);
});

test('static assets are served from the public directory', async () => {
  const { app } = createContext();
  const css = await request(app).get('/css/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);

  const js = await request(app).get('/js/app.js');
  assert.equal(js.status, 200);

  // Nothing outside public/ is reachable.
  for (const path of ['/src/config.js', '/.env', '/package.json', '/src/db/migrations/001_init.sql']) {
    const blocked = await request(app).get(path);
    assert.equal(blocked.status, 404, `${path} must not be publicly served`);
  }
});

test('lesson content is escaped before it is rendered', async () => {
test('the account page shows profile data but never the Google subject id', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, { email: 'profile@example.test', username: 'profile1' });
  const auth = login(db, config, user);

  const response = await request(app).get('/settings/profile').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /profile@example\.test/);
  assert.doesNotMatch(response.text, /sub:profile@example\.test/, 'stable Google identifier stays server-side');
  assert.doesNotMatch(response.text, /google_sub/i);
});

test('every page renders for a signed-in student', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);
  const { quizSlug } = seedContent(db);

  const paths = ['/dashboard', '/modules', '/quizzes', `/quizzes/${quizSlug}`, '/settings/profile'];
  for (const page of paths) {
    const response = await request(app).get(page).set('Cookie', auth.cookie);
    assert.equal(response.status, 200, `${page} should render`);
    assert.doesNotMatch(response.text, /Something went wrong/, `${page} should not show the error page`);
  }
});

test('the admin shell renders without template errors', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, { username: 'boss', role: 'admin' });
  const auth = login(db, config, user);
  seedContent(db);

  const response = await request(app).get('/admin').set('Cookie', auth.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /Admin overview/);
  assert.match(response.text, /ACTIVE STUDENTS/);
  assert.match(response.text, /PUBLISHED MODULES/);
  assert.match(response.text, /PUBLISHED QUIZZES/);
  assert.match(response.text, /AVERAGE SCORE/);
});

test('a pending account sees the setup page and nothing else', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, { status: 'pending_setup' });
  const auth = login(db, config, user);

  const setup = await request(app).get('/setup').set('Cookie', auth.cookie);
  assert.equal(setup.status, 200);
  assert.match(setup.text, /Finish your CyberSafe account/);

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.location, '/setup');
});

});
