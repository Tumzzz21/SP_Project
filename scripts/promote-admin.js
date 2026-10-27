'use strict';

/**
 * Provision an administrator. Deliberately a server-side script: CyberSafe has
 * no public route that can grant the admin role.
 *
 * Usage:
 *   npm run create-admin -- --email instructor@school.edu
 *
 * The person must already have signed in with Google and completed account
 * setup, so the promoted account is tied to a verified identity.
 */

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { openDatabase, runMigrations } = require('../src/db');
const users = require('../src/db/users');

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function main() {
  const email = argValue('email');
  if (!email) {
    fail('Provide the account email, e.g. npm run create-admin -- --email you@school.edu');
  }

  const config = loadConfig();
  const db = openDatabase(config.database.file);
  runMigrations(db);

  try {
    const user = users.findByEmail(db, email);
    if (!user) {
      fail(
        `No CyberSafe account uses "${email}". Sign in with Google and finish account setup first, then run this script again.`,
      );
    }
    if (user.status === 'pending_setup') {
      fail(
        `"${email}" has not finished account setup yet. Complete the setup page, then run this script again.`,
      );
    }
    if (user.status === 'disabled') {
      fail(`"${email}" is disabled. Re-enable the account before promoting it.`);
    }
    if (user.role === 'admin') {
      console.log(`${email} is already an administrator.`);
      return;
    }

    users.setRole(db, user.id, 'admin');
    console.log(`Promoted ${email} (username: ${user.username}) to admin.`);
    console.log('Existing sessions keep working; the new role applies on the next request.');
  } finally {
    db.close();
  }
}

main();
