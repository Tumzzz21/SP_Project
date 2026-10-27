'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login } = require('./helpers');

function pendingUser(db) {
  return createUser(db, { email: 'new@example.test', status: 'pending_setup' });
}

test('a half-registered account is pushed to the setup page', async () => {
  const { app, db, config } = createContext();
  const user = pendingUser(db);
  const auth = login(db, config, user);

  const setup = await request(app).get('/setup').set('Cookie', auth.cookie);
  assert.equal(setup.status, 200);
  assert.match(setup.text, /Finish your CyberSafe account/);
  assert.match(setup.text, /One-time setup/);

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.location, '/setup');

  const api = await request(app).get('/api/lessons').set('Cookie', auth.cookie);
  assert.equal(api.status, 409);
  assert.equal(api.body.error.code, 'setup_required');
});

test('setup rejects invalid and reserved usernames with field errors', async () => {
  const { app, db, config } = createContext();
  const auth = login(db, config, pendingUser(db));

  const short = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, username: 'ab', displayName: 'Ana' });
  assert.equal(short.status, 400);
  assert.match(short.text, /3–20 characters/);

  const reserved = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, username: 'admin', displayName: 'Ana' });
  assert.equal(reserved.status, 400);
  assert.match(reserved.text, /reserved/);

  const noName = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, username: 'ana_01', displayName: '' });
  assert.equal(noName.status, 400);
  assert.match(noName.text, /Enter the name/);
});

test('setup rejects a username taken by another account', async () => {
  const { app, db, config } = createContext();
  createUser(db, { email: 'taken@example.test', username: 'takenname' });
  const auth = login(db, config, pendingUser(db));

  const response = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, username: 'TakenName', displayName: 'Ana' });

  assert.equal(response.status, 409);
  assert.match(response.text, /already taken/);
  assert.equal(
    db.prepare('SELECT status FROM users WHERE email = ?').get('new@example.test').status,
    'pending_setup',
  );
});

test('setup completes the account and activates it', async () => {
  const { app, db, config } = createContext();
  const auth = login(db, config, pendingUser(db));

  const response = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, username: 'Ana_Santos', displayName: '  Ana   Santos  ' });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/dashboard?notice=setup_complete');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('new@example.test');
  assert.equal(user.username, 'ana_santos', 'usernames are normalised to lowercase');
  assert.equal(user.display_name, 'Ana Santos');
  assert.equal(user.status, 'active');
  assert.ok(user.setup_completed_at, 'setup timestamp recorded');

  const dashboard = await request(app).get('/dashboard').set('Cookie', auth.cookie);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Ana Santos/);
  assert.match(dashboard.text, /Your CyberSafe account is ready|Welcome/);
});

test('a registered account cannot repeat setup', async () => {
  const { app, db, config } = createContext();
  const user = createUser(db, { email: 'done@example.test', username: 'doneuser' });
  const auth = login(db, config, user);

  const page = await request(app).get('/setup').set('Cookie', auth.cookie);
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, '/dashboard');

  const post = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ _csrf: auth.csrfToken, username: 'othername', displayName: 'Other Name' });
  assert.equal(post.status, 302);
  assert.equal(
    db.prepare('SELECT username FROM users WHERE id = ?').get(user.id).username,
    'doneuser',
    'a finished account keeps its username',
  );
});

test('setup requires a CSRF token', async () => {
  const { app, db, config } = createContext();
  const auth = login(db, config, pendingUser(db));

  const response = await request(app)
    .post('/setup')
    .set('Cookie', auth.cookie)
    .type('form')
    .send({ username: 'ana_01', displayName: 'Ana' });

  assert.equal(response.status, 403);
  assert.equal(
    db.prepare('SELECT status FROM users WHERE email = ?').get('new@example.test').status,
    'pending_setup',
  );
});
