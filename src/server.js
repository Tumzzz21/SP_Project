'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('./config');
const { createDatabase } = require('./db');
const { createGoogleClient } = require('./auth/oidc');
const { createApp } = require('./app');
const { purgeExpired } = require('./db/sessions');

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
    return;
  }

  for (const warning of config.warnings) {
    console.warn(`[config] ${warning}`);
  }

  const db = createDatabase({ file: config.database.file });
  const purged = purgeExpired(db);
  if (purged > 0) console.log(`[sessions] removed ${purged} expired session(s)`);

  const oidc = createGoogleClient({ config });
  const app = createApp({ config, db, oidc });

  if (!config.google.configured) {
    console.warn(
      '[auth] Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. ' +
        (config.devAuth
          ? 'Development sign-in is enabled for local testing.'
          : 'Sign-in is disabled until credentials are added.'),
    );
  } else if (config.devAuth) {
    console.warn('[auth] AUTH_DEV_MODE is on. Disable it before sharing this server with anyone.');
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`CyberSafe listening on ${config.appBaseUrl} (env: ${config.env})`);
    console.log(`Database: ${config.database.file}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set PORT in .env to a free port.`);
    } else {
      console.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] ${signal} received, closing.`);
    server.close(() => {
      try {
        db.close();
      } catch {
        // already closed
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
