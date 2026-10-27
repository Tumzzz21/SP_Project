'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/config');
const { openDatabase, runMigrations } = require('../src/db');

function main() {
  const config = loadConfig();
  const db = openDatabase(config.database.file);

  try {
    const applied = runMigrations(db);
    if (applied.length === 0) {
      console.log('Database is already up to date.');
    } else {
      for (const file of applied) console.log(`Applied migration: ${file}`);
    }
    console.log(`Database file: ${config.database.file}`);
  } finally {
    db.close();
  }
}

main();
