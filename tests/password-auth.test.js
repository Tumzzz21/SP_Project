'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, testConfig, createUser } = require('./helpers');
const users = require('../src/db/users');
const { hashPassword, verifyPassword } = require('../src/auth/passwords');

const PASSWORD = 'correct horse battery staple';

/** Register helper: anonymous (no cookie), so no CSRF token is required. */
function postRegister(app, fields = {}) {
  return request(app)
    .post('/auth/register')
    .type('form')
    .send({
      email: 'localstudent@example.test',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      ...fields,
    });
}

/** Login helper: sent without a cookie, like a fresh browser. */
function postLogin(app, fields = {}) {
  return request(app)
    .post('/auth/login')
    .type('form')
    .send({ email: 'localstudent@example.test', password: PASSWORD, ...fields });
}

function sessionCookieFrom(response) {
  const raw = (response.headers['set-cookie'] || []).find((c) => c.startsWith('cybersafe.sid='));
  return raw ? raw.split(';')[0] : null;
}

test('registering with email and password creates a pending student with a hashed password', async () => {
  const { app, db } = createContext();

  const response = await postRegister(app);
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/setup?notice=account_created');
  assert.ok(sessionCookieFrom(response), 'registration opens a server-side session');

  const row = db.prepare('SELECT * FROM users').get();
  assert.equal(row.role, 'student');
  assert.equal(row.status, 'pending_setup');
  assert.equal(row.google_sub, 'local:localstudent@example.test');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes(PASSWORD), 'plaintext password never stored');

  // The stored hash verifies the real password and rejects a wrong one.
  const creds = users.findLocalCredentials(db, 'localstudent@example.test');
  assert.equal(await verifyPassword(PASSWORD, creds.passwordHash), true);
  assert.equal(await verifyPassword('wrong password', creds.passwordHash), false);

  // The created account lands on first-time setup with the success notice.
  const cookie = sessionCookieFrom(response);
  const setup = await request(app).get('/setup?notice=account_created').set('Cookie', cookie);
  assert.equal(setup.status, 200);
  assert.match(setup.text, /Your account was created\./);
});

test('duplicate email registration is rejected and creates no second account', async () => {
  const { app, db } = createContext();

  const first = await postRegister(app);
  assert.equal(first.status, 303);

  const second = await postRegister(app);
  assert.equal(second.status, 409);
  assert.match(second.text, /already exists/i);

  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 1);
});

test('registration validates password length and confirmation', async () => {
  const { app, db } = createContext();

  const short = await postRegister(app, { password: 'short1', confirmPassword: 'short1' });
  assert.equal(short.status, 400);
  assert.match(short.text, /at least 8 characters/i);

  const mismatch = await postRegister(app, { confirmPassword: 'a different password' });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /Both passwords must match\./);
  // The submitted password is never echoed back into the re-rendered form.
  assert.ok(!mismatch.text.includes(PASSWORD), 'password must not be reflected');

  const badEmail = await postRegister(app, { email: 'not-an-email' });
  assert.equal(badEmail.status, 400);
  assert.match(badEmail.text, /valid email address/i);

  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 0);
});

test('password login starts a real session and routes by account state', async () => {
  const { app, db, config } = createContext();

  await postRegister(app);
  const userId = users.findByEmail(db, 'localstudent@example.test').id;

  // Still pending setup -> first-time setup page.
  const pending = await postLogin(app);
  assert.equal(pending.status, 303);
  assert.equal(pending.headers.location, '/setup');

  users.completeSetup(db, userId, { username: 'pwstudent', displayName: 'Password Student' });

  // Active student -> dashboard, with a working session cookie.
  const active = await postLogin(app);
  assert.equal(active.status, 303);
  assert.equal(active.headers.location, '/dashboard');
  const cookie = sessionCookieFrom(active);
  assert.ok(cookie);
  const dashboard = await request(app).get('/dashboard').set('Cookie', cookie);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Student One|Password Student/);

  // An explicit next path is honoured for active accounts.
  const next = await postLogin(app, { next: '/account' });
  assert.equal(next.status, 303);
  assert.equal(next.headers.location, '/account');
  assert.equal(config.session.cookieName, 'cybersafe.sid');
});

test('wrong password and unknown email get the identical answer with no session', async () => {
  const { app } = createContext();
  await postRegister(app);

  const wrongPassword = await postLogin(app, { password: 'definitely not the password' });
  assert.equal(wrongPassword.status, 401);
  assert.match(wrongPassword.text, /Email or password is incorrect\. Please try again\./);

  const unknownEmail = await postLogin(app, { email: 'nobody@example.test' });
  assert.equal(unknownEmail.status, 401);
  assert.match(unknownEmail.text, /Email or password is incorrect\. Please try again\./);

  for (const response of [wrongPassword, unknownEmail]) {
    const cookie = sessionCookieFrom(response);
    assert.equal(cookie, null, 'failed logins must not open a session');
  }
});

test('disabled accounts cannot sign in with a password', async () => {
  const { app, db } = createContext();
  await postRegister(app);
  const user = users.findByEmail(db, 'localstudent@example.test');
  users.completeSetup(db, user.id, { username: 'pwstudent', displayName: 'Password Student' });
  users.setStatus(db, user.id, 'disabled');

  const response = await postLogin(app);
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?error=account_disabled');
  assert.equal(sessionCookieFrom(response), null);
});

test('Google-only accounts cannot use password login', async () => {
  const { app, db } = createContext();
  createUser(db, { email: 'googler@example.test', username: 'googler', displayName: 'Googler' });

  const response = await request(app)
    .post('/auth/login')
    .type('form')
    .send({ email: 'googler@example.test', password: PASSWORD });

  assert.equal(response.status, 401);
  assert.match(response.text, /Email or password is incorrect\. Please try again\./);
  assert.equal(sessionCookieFrom(response), null);
});

test('forgot password is an honest notice, not a fake reset flow', async () => {
  const { app } = createContext();

  const response = await request(app)
    .post('/auth/forgot-password')
    .type('form')
    .send({ email: 'localstudent@example.test' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/forgot-password?notice=reset_unavailable');

  const page = await request(app).get('/forgot-password?notice=reset_unavailable');
  assert.equal(page.status, 200);
  assert.match(page.text, /Password reset emails are not configured on this site yet\./);
  // No token, no "check your inbox" claim.
  assert.ok(!page.text.includes('Check your inbox'));
  assert.ok(!page.text.includes('reset token'));
});

test('the login card presents email/password alongside Google', async () => {
  const googleOn = createContext({
    config: testConfig({ google: { configured: true, status: 'configured', clientId: 'id', clientSecret: 'secret' } }),
  });
  const login = await request(googleOn.app).get('/login');
  assert.equal(login.status, 200);
  assert.match(login.text, /Sign in to CyberSafe/);
  assert.match(login.text, /Email Address/);
  assert.match(login.text, /e\.g\. your\.email@example\.com/);
  assert.match(login.text, /Forgot Password\?/);
  assert.match(login.text, /name="password"/);
  assert.match(login.text, /data-toggle-password/, 'show/hide eye toggle is wired up');
  assert.match(login.text, /<button class="btn btn-dark btn-block" type="submit">Sign In<\/button>/);
  assert.match(login.text, /auth-divider/, 'divider before external auth');
  assert.match(login.text, /Continue with Google/);
  assert.match(login.text, /Don't have an account\?/);
  assert.match(login.text, />Sign up</);
  // The sign-in page never shows backend configuration text.
  assert.ok(!login.text.includes('GOOGLE_CLIENT_ID'));
  assert.ok(!login.text.includes('.env'));

  const googleOff = createContext();
  const offPage = await request(googleOff.app).get('/login');
  assert.ok(!offPage.text.includes('Continue with Google'));
  // No configuration notice and no empty divider without an external option.
  assert.ok(!offPage.text.includes('not configured'));
  assert.ok(!offPage.text.includes('GOOGLE_CLIENT_ID'));
  assert.ok(!offPage.text.includes('auth-divider'));
  assert.match(offPage.text, /Sign in to CyberSafe/);
});

test('no development sign-in section or development banner ever renders on pages', async () => {
  // devAuth on (and Google off) is the exact setup where the old development
  // clutter used to appear.
  const devCtx = createContext({ config: testConfig({ devAuth: true }) });

  const login = await request(devCtx.app).get('/login');
  assert.equal(login.status, 200);
  for (const fragment of [
    'Local development sign-in',
    'Email for local testing',
    'Sign in for development',
    'AUTH_DEV_MODE',
    'Development mode',
    'dev-signin',
    'dev-banner',
  ]) {
    assert.ok(!login.text.includes(fragment), `login page must not contain "${fragment}"`);
  }
  assert.ok(!login.text.includes('GOOGLE_CLIENT_ID'), 'no backend config text on login');
  assert.ok(login.text.includes('name="password"'), 'the production form is still there');

  // The shared header partial is on every page, so check a public page too.
  const landing = await request(devCtx.app).get('/');
  assert.ok(!landing.text.includes('Development mode'));
  assert.ok(!landing.text.includes('AUTH_DEV_MODE'));
});

test('everyone signs in through the same entry; role comes from the account', async () => {
  const { app } = createContext();
  const login = await request(app).get('/login');
  assert.equal(login.status, 200);
  assert.match(login.text, /Sign in to CyberSafe/);
  assert.match(login.text, /name="password"/);
  assert.match(login.text, /Don't have an account\?/);
  // /admin-login is the same sign-in view (titled for administrators and
  // defaulting the post-login redirect to /admin); an account's role is set
  // server-side, not chosen at the sign-in page.
  const admin = await request(app).get('/admin-login');
  assert.equal(admin.status, 200);
  assert.match(admin.text, /Sign in to CyberSafe/);
  assert.match(admin.text, /name="password"/);
  const register = await request(app).get('/register');
  assert.equal(register.status, 200);
  assert.match(register.text, /name="email"/);
  assert.match(register.text, /name="password"/);
  assert.match(register.text, /name="confirmPassword"/);
});

test('registration never grants admin even when the request demands it', async () => {
  const { app, db } = createContext();

  const response = await postRegister(app, { role: 'admin', username: 'attacker' });
  assert.equal(response.status, 303);

  const row = db.prepare('SELECT role, status FROM users').get();
  assert.equal(row.role, 'student');
  assert.equal(row.status, 'pending_setup');
});

test('the password never appears in page responses after sign-in', async () => {
  const { app, db } = createContext();
  const reg = await postRegister(app);
  const cookie = sessionCookieFrom(reg);
  const userId = users.findByEmail(db, 'localstudent@example.test').id;
  users.completeSetup(db, userId, { username: 'pwstudent', displayName: 'Password Student' });

  for (const path of ['/dashboard', '/account', '/learn', '/quizzes', '/api/me']) {
    const response = await request(app).get(path).set('Cookie', cookie);
    assert.ok(response.status === 200, `${path} should render, got ${response.status}`);
    assert.ok(
      !response.text.includes(PASSWORD) && !response.text.includes('scrypt$'),
      `${path} must not leak password material`,
    );
  }
});
