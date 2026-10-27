'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { AppError } = require('../src/errors');
const { createContext, testConfig, createUser, login } = require('./helpers');

function stubOidc(overrides = {}) {
  return {
    configured: true,
    async buildAuthorizationUrl({ state, nonce, codeChallenge }) {
      return `https://accounts.example.test/authorize?state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}&code_challenge=${encodeURIComponent(codeChallenge)}`;
    },
    async exchangeCodeAndVerify() {
      return {
        googleSub: 'google-sub-new',
        email: 'new.student@example.test',
        emailVerified: true,
        name: 'New Student',
      };
    },
    ...overrides,
  };
}

function insertState(db, { state = 'state-1', nonce = 'nonce-1', verifier = 'verifier-1', expiresAt } = {}) {
  db.prepare(
    `INSERT INTO oidc_states (state, nonce, code_verifier, return_to, created_at, expires_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(
    state,
    nonce,
    verifier,
    new Date().toISOString(),
    expiresAt || new Date(Date.now() + 60_000).toISOString(),
  );
}

test('google start explains that OAuth is not configured instead of pretending to work', async () => {
  const { app } = createContext();
  const response = await request(app).get('/auth/google/start');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=oauth_not_configured');
});

test('google start creates a single-use state row with a PKCE challenge', async () => {
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc: stubOidc() });

  const response = await request(app).get('/auth/google/start');
  assert.equal(response.status, 302);
  assert.match(response.headers.location, /^https:\/\/accounts\.example\.test\/authorize\?/);
  assert.match(response.headers.location, /code_challenge=/);

  const states = db.prepare('SELECT state, nonce, code_verifier AS verifier FROM oidc_states').all();
  assert.equal(states.length, 1);
  assert.ok(states[0].verifier.length > 20, 'PKCE verifier must be long enough');

  // The state in the URL must match the stored row, and must not reuse the nonce.
  const url = new URL(response.headers.location);
  assert.equal(url.searchParams.get('state'), states[0].state);
  assert.notEqual(states[0].nonce, states[0].state, 'the nonce must be distinct from the state');
});

test('callback rejects an unknown or already consumed state', async () => {
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc: stubOidc() });

  const response = await request(app).get('/auth/google/callback?code=abc&state=not-a-real-state');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=oauth_expired');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
});

test('callback rejects an expired state', async () => {
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc: stubOidc() });
  insertState(db, { expiresAt: new Date(Date.now() - 1000).toISOString() });

  const response = await request(app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=oauth_expired');
});

test('callback maps a failed token verification to a sign-in error and creates no session', async () => {
  const failing = stubOidc({
    async exchangeCodeAndVerify() {
      throw new AppError(401, 'Google returned a sign-in token we could not trust.', {
        code: 'oidc_token_invalid',
      });
    },
  });
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc: failing });
  insertState(db);

  const response = await request(app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=oauth_failed');
  assert.equal(response.headers['set-cookie'], undefined, 'no session cookie on failed verification');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
});

test('callback creates a pending account and sets a hardened cookie', async () => {
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc: stubOidc() });
  insertState(db);

  const response = await request(app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/setup');

  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);

  const user = db.prepare('SELECT * FROM users').get();
  assert.equal(user.email, 'new.student@example.test');
  assert.equal(user.role, 'student', 'public sign-up must never create an admin');
  assert.equal(user.status, 'pending_setup');
  assert.equal(user.username, null);
  assert.equal(user.email_verified, 1);

  // The state row is consumed, so replaying the callback cannot sign in again.
  const replay = await request(app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(replay.headers.location, '/login?error=oauth_expired');
});

test('returning students and admins land on their own dashboard', async () => {
  const student = createContext({
    config: testConfig({ google: { configured: true } }),
    oidc: stubOidc({
      async exchangeCodeAndVerify() {
        return { googleSub: 'sub:student@example.test', email: 'student@example.test', emailVerified: true, name: 'Student' };
      },
    }),
  });
  const studentUser = createUser(student.db, { email: 'student@example.test' });
  insertState(student.db);
  const studentResponse = await request(student.app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(studentResponse.status, 303);
  assert.equal(studentResponse.headers.location, '/dashboard');
  assert.equal(
    student.db.prepare('SELECT email FROM users WHERE id = ?').get(studentUser.id).email,
    'student@example.test',
  );

  const admin = createContext({
    config: testConfig({ google: { configured: true } }),
    oidc: stubOidc({
      async exchangeCodeAndVerify() {
        return { googleSub: 'sub:admin@example.test', email: 'admin@example.test', emailVerified: true, name: 'Admin' };
      },
    }),
  });
  createUser(admin.db, { email: 'admin@example.test', username: 'adminuser', role: 'admin' });
  insertState(admin.db);
  const adminResponse = await request(admin.app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(adminResponse.headers.location, '/admin');
});

test('a disabled account is refused at the callback', async () => {
  const oidc = stubOidc({
    async exchangeCodeAndVerify() {
      return { googleSub: 'sub:closed@example.test', email: 'closed@example.test', emailVerified: true, name: 'Closed' };
    },
  });
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc });
  createUser(db, { email: 'closed@example.test', username: 'closed', status: 'disabled' });
  insertState(db);

  const response = await request(app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=account_disabled');
  assert.equal(response.headers['set-cookie'], undefined);
});

test('a different Google account with the same email cannot hijack an existing account', async () => {
  const oidc = stubOidc({
    async exchangeCodeAndVerify() {
      return { googleSub: 'google-sub-attacker', email: 'victim@example.test', emailVerified: true, name: 'Someone' };
    },
  });
  const { app, db } = createContext({ config: testConfig({ google: { configured: true } }), oidc });
  createUser(db, { email: 'victim@example.test', username: 'victim' });
  insertState(db);

  const response = await request(app).get('/auth/google/callback?code=abc&state=state-1');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=account_conflict');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 1);
});

test('the development sign-in route does not exist unless devAuth is on', async () => {
  const { app, db } = createContext();
  const response = await request(app).post('/auth/dev-login').type('form').send({ email: 'dev@example.test' });
  assert.equal(response.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 0);
});

test('the development sign-in only ever creates students', async () => {
  const { app, db } = createContext({ config: testConfig({ devAuth: true }) });

  const response = await request(app)
    .post('/auth/dev-login')
    .type('form')
    .send({ email: 'dev.student@example.test' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/dashboard');
  assert.match(response.headers['set-cookie'][0], /HttpOnly/i);

  const user = db.prepare('SELECT * FROM users').get();
  assert.equal(user.role, 'student');
  assert.equal(user.status, 'active');
  assert.ok(user.username, 'dev sign-in completes setup so dashboards are reachable');
});

test('logout requires a CSRF token and destroys the server-side session', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, {});
  const auth = login(db, config, user);

  const withoutToken = await request(app).post('/auth/logout').set('Cookie', auth.cookie);
  assert.equal(withoutToken.status, 403);

  const withToken = await request(app)
    .post('/auth/logout')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken });
  assert.equal(withToken.status, 303);

  const afterLogout = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(afterLogout.status, 302);
  assert.equal(afterLogout.headers.location, '/login?next=%2Fdashboard');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
});
