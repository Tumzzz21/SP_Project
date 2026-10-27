'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../src/config');

const ROOT = path.join(__dirname, '..');

test('production refuses to enable the development sign-in', () => {
  const config = loadConfig({ NODE_ENV: 'production', AUTH_DEV_MODE: 'true' });
  assert.equal(config.devAuth, false);
  assert.ok(config.warnings.some((warning) => warning.includes('AUTH_DEV_MODE')));
});

test('development sign-in must be switched on explicitly', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).devAuth, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', AUTH_DEV_MODE: 'true' }).devAuth, true);
});

test('production defaults to a Secure, __Host- prefixed session cookie', () => {
  const config = loadConfig({ NODE_ENV: 'production' });
  assert.equal(config.session.cookieSecure, true);
  assert.equal(config.session.cookieName, '__Host-cybersafe.sid');
  assert.equal(config.session.sameSite, 'lax');
});

test('local development uses a non-Secure cookie name for plain HTTP', () => {
  const config = loadConfig({ NODE_ENV: 'development' });
  assert.equal(config.session.cookieSecure, false);
  assert.equal(config.session.cookieName, 'cybersafe.sid');
});

test('half-configured Google credentials are reported, not silently accepted', () => {
  const config = loadConfig({ GOOGLE_CLIENT_ID: 'only-the-id' });
  assert.equal(config.google.configured, false);
  assert.equal(config.google.status, 'incomplete');
  assert.ok(config.warnings.some((warning) => warning.includes('GOOGLE_CLIENT_SECRET')));
});

test('complete Google credentials mark OAuth as configured', () => {
  const config = loadConfig({
    GOOGLE_CLIENT_ID: 'example.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'example-secret',
  });
  assert.equal(config.google.configured, true);
  assert.equal(config.google.status, 'configured');
  assert.equal(config.google.redirectUri, 'http://localhost:3000/auth/google/callback');
  assert.equal(config.devAuth, false);
});

test('an invalid port fails fast', () => {
  assert.throws(() => loadConfig({ PORT: 'not-a-port' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
});

test('the example environment file contains placeholders only', () => {
  const content = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.match(content, /GOOGLE_CLIENT_ID=your-client-id/);
  assert.doesNotMatch(content, /AIza[0-9A-Za-z_-]{10,}/, 'no real API keys');
  assert.doesNotMatch(content, /GOCSPX-[0-9A-Za-z_-]{10,}/, 'no real OAuth client secrets');
  assert.doesNotMatch(content, /ya29\./, 'no access tokens');
});

test('gitignore protects secrets, the local database, and logs', () => {
  const content = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  for (const pattern of ['.env', 'node_modules', 'data', '*.db', '*.log']) {
    assert.ok(
      lines.some((line) => line === pattern || line === `${pattern}/`),
      `.gitignore must ignore ${pattern}`,
    );
  }
  assert.ok(lines.includes('!.env.example'), '.env.example must remain commit-able');
});

test('secrets are not reachable from the public web directory', () => {
  const publicEntries = fs.readdirSync(path.join(ROOT, 'public'));
  assert.ok(!publicEntries.includes('.env'), 'public/ must not contain environment files');
  assert.ok(!publicEntries.includes('data'), 'public/ must not contain the database');
});
