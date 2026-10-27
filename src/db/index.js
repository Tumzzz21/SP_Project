'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Open a SQLite database with the pragmas CyberSafe relies on.
 * @param {string} file absolute path, or ':memory:' for tests
 */
function openDatabase(file = ':memory:') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (file !== ':memory:') {
    // WAL keeps reads fast while a write is in progress; harmless locally.
    db.pragma('journal_mode = WAL');
  }
  return db;
}

/**
 * Apply every pending migration file once, in filename order, each inside its
 * own transaction. Returns the list of migrations applied in this call.
 */
function runMigrations(db, dir = MIGRATIONS_DIR) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id),
  );
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(file);
    });
    migrate();
    newlyApplied.push(file);
  }
  return newlyApplied;
}

/**
 * Open + migrate in one call. Used by the server and by scripts.
 */
function createDatabase({ file, migrate = true } = {}) {
  const db = openDatabase(file);
  if (migrate) runMigrations(db);
  return db;
}

module.exports = { openDatabase, runMigrations, createDatabase, MIGRATIONS_DIR };
