'use strict';

/**
 * Create local demo accounts for development and classroom walkthroughs.
 *
 *   npm run setup-test-accounts
 *
 * Produces (idempotently):
 *   - student@example.test  -> active student  (username: student1, or a
 *                               numbered variant if student1 already exists)
 *   - admin@example.test    -> active admin    (username: admin1, likewise)
 *
 * Both accounts go through the same createPendingUser/completeSetup path the
 * dev sign-in flow uses, and admin rights are granted with users.setRole -
 * the same call the documented promote-admin script makes. Each account also
 * gets a password so it can sign in through the normal email/password form
 * (the sign-in page has no development section). The demo password below is
 * intentionally public: these are throwaway local accounts for a local
 * database, never used anywhere else. This script never runs against
 * production: config.loadConfig refuses AUTH_DEV_MODE-style local helpers
 * when NODE_ENV=production, and this script refuses to run if dev auth is not
 * enabled for the current environment.
 */

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { openDatabase, runMigrations } = require('../src/db');
const users = require('../src/db/users');
const { hashPassword } = require('../src/auth/passwords');

const DEMO_PASSWORD = 'cybersafe-local-demo';

const TEST_ACCOUNTS = [
  { email: 'student@example.test', username: 'student1', displayName: 'Student One', role: 'student' },
  { email: 'admin@example.test', username: 'admin1', displayName: 'Admin One', role: 'admin' },
];

function ensureAccount(db, { email, username, displayName, role }, passwordHash) {
  const googleSub = `dev:${email}`;
  let user = users.findByGoogleSub(db, googleSub);
  let created = false;

  if (!user) {
    user = users.createPendingUser(db, { googleSub, email, emailVerified: true });
    created = true;
  }

  if (user.status === 'disabled') {
    console.log(`- ${email}: exists but is disabled; re-enable it before using it.`);
    return;
  }

  if (user.status === 'pending_setup') {
    // The desired username may already belong to another local account; fall
    // back to numbered variants rather than failing the whole run.
    let chosen = username;
    let suffix = 0;
    for (;;) {
      try {
        user = users.completeSetup(db, user.id, { username: chosen, displayName });
        break;
      } catch (error) {
        if (error.code !== 'username_taken') throw error;
        suffix += 1;
        chosen = `${username}${suffix}`;
        if (suffix > 20) throw error;
      }
    }
    console.log(`- ${email}: activated (username: ${chosen}).`);
  } else if (created) {
    console.log(`- ${email}: created (username: ${user.username}).`);
  } else {
    console.log(`- ${email}: already exists (username: ${user.username}).`);
  }

  if (role === 'admin' && user.role !== 'admin') {
    users.setRole(db, user.id, 'admin');
    console.log(`  -> promoted to admin (same setRole call as scripts/promote-admin.js).`);
  } else {
    console.log(`  -> role: ${users.findById(db, user.id).role}`);
  }

  // Give the account a password if it does not have one yet, so the normal
  // email/password form on /login can sign it in. Never overwrites an
  // existing hash.
  const existing = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!existing.password_hash) {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, users.nowIso(), user.id);
    console.log('  -> password set for local sign-in.');
  }
}

async function main() {
  const config = loadConfig();
  if (!config.devAuth) {
    console.error(
      'Error: development sign-in is not enabled. Set AUTH_DEV_MODE=true (and NODE_ENV=development), then retry.',
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const db = openDatabase(config.database.file);
  runMigrations(db);
  try {
    console.log(`Using ${config.database.file}`);
    for (const account of TEST_ACCOUNTS) ensureAccount(db, account, passwordHash);
    console.log(
      `Done. Sign in at /login with these emails and the local demo password:\n  ${DEMO_PASSWORD}`,
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
