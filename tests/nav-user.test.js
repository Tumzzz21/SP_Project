'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login } = require('./helpers');

async function signedIn(overrides) {
  const ctx = createContext(overrides || {});
  const user = createUser(ctx.db, {
    email: 'aldrinlance19@gmail.com',
    username: 'aldrin',
    displayName: 'Aldrin'
  });
  const auth = login(ctx.db, ctx.config, user);
  return { ctx, user, auth };
}

test('the avatar is a dropdown trigger with the user details inside', async () => {
  const { ctx, auth } = await signedIn();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  assert.equal(response.status, 200);

  // trigger
  assert.match(response.text, /<button[^>]*class="nav-avatar"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"[^>]*aria-controls="nav-user-panel"/);
  assert.match(response.text, /data-user-menu-toggle/);

  // panel starts closed
  assert.match(response.text, /class="nav-user-panel" id="nav-user-panel" data-user-menu-panel hidden/);

  // user info header
  assert.match(response.text, /class="nav-user-name">Aldrin</);
  assert.match(response.text, /class="nav-user-email">aldrinlance19@gmail\.com</);

  // divider + the two options
  assert.match(response.text, /class="nav-user-divider"/);
  assert.match(response.text, /class="nav-user-item" href="\/account"/);
  assert.match(response.text, /Account Settings/);
  assert.match(response.text, /class="nav-user-item nav-user-signout"/);
  assert.match(response.text, /Sign Out/);
  assert.match(response.text, /action="\/auth\/logout"/);
});

test('the top bar does not repeat the Account link owned by the dropdown', async () => {
  const { ctx, auth } = await signedIn();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  // the ordinary Account link is gone, because the dropdown already reaches it
  assert.ok(!response.text.includes('<a href="/account"'), 'the top bar must not render a separate Account link');
  // and the page is still reachable through the dropdown item
  assert.match(response.text, /class="nav-user-item" href="\/account"/);
});

test('the standalone sign out control is gone from the top bar', async () => {
  const { ctx, auth } = await signedIn();
  const response = await request(ctx.app).get('/dashboard').set('Cookie', auth.cookie);

  // no separate logout form in the nav bar itself
  assert.ok(!response.text.includes('class="nav-logout"'), 'the nav must not render a standalone logout form');

  // exactly one logout form on the page, inside the dropdown panel
  const logoutForms = response.text.match(/action="\/auth\/logout"/g) || [];
  assert.equal(logoutForms.length, 1);
});

test('the account page no longer offers a sign out button in the sign-in method card', async () => {
  const { ctx, auth } = await signedIn();
  const response = await request(ctx.app).get('/account').set('Cookie', auth.cookie);

  assert.equal(response.status, 200);
  assert.ok(!response.text.includes('Sign out of this session'), 'the sign-in method card must not contain a sign out button');
  assert.match(response.text, /You sign in with Google\./);
  assert.match(response.text, /Sign-in method/);
  // the session information stays
  assert.match(response.text, /active session/);
});

test('the account dropdown still signs the user out through the session route', async () => {
  const { ctx, auth } = await signedIn();
  const response = await request(ctx.app)
    .post('/auth/logout')
    .set('Cookie', auth.cookie)
    .send({ _csrf: auth.csrfToken });

  assert.ok([302, 303].includes(response.status));
  assert.match(response.headers.location || '', /^\//);
});
