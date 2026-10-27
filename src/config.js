'use strict';

/**
 * Central configuration loader.
 *
 * Every secret comes from the environment (a local `.env` file during
 * development). Nothing secret is ever baked into the source tree or the
 * public web directory.
 */

const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

/** @param {string|undefined} value @param {boolean} fallback */
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/** @param {string|undefined} value @param {number} fallback */
function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build the runtime configuration object.
 * Throws only for values that make the server unsafe or unable to start.
 * @param {NodeJS.ProcessEnv} env
 */
function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const warnings = [];

  const rawPort = env.PORT === undefined || env.PORT === null ? '' : String(env.PORT).trim();
  let port = 3000;
  if (rawPort !== '') {
    if (!/^\d+$/.test(rawPort)) {
      throw new Error(`PORT must be a whole number (received "${rawPort}").`);
    }
    port = Number.parseInt(rawPort, 10);
    if (port < 1 || port > 65535) {
      throw new Error(`PORT must be between 1 and 65535 (received "${rawPort}").`);
    }
  }

  const host = (env.HOST || '127.0.0.1').trim();
  const appBaseUrl = (env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  let googleStatus = 'unconfigured';
  if (clientId && clientSecret) {
    googleStatus = 'configured';
  } else if (clientId || clientSecret) {
    googleStatus = 'incomplete';
    warnings.push(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set. Google sign-in stays disabled until they are.',
    );
  }

  // A development-only credential-free sign-in. It is hard-disabled in
  // production, and even in development it must be switched on explicitly.
  const devAuthRequested = parseBoolean(env.AUTH_DEV_MODE, false);
  if (devAuthRequested && isProduction) {
    warnings.push('AUTH_DEV_MODE is ignored because NODE_ENV=production. Development sign-in is disabled.');
  }
  const devAuth = devAuthRequested && !isProduction;

  const sessionTtlHours = Math.min(Math.max(parseInteger(env.SESSION_TTL_HOURS, 12), 1), 24 * 30);
  const cookieSecure = parseBoolean(env.SESSION_COOKIE_SECURE, isProduction);

  if (isProduction && !cookieSecure) {
    warnings.push('SESSION_COOKIE_SECURE is disabled in production. Session cookies would be sent over plain HTTP.');
  }

  const databaseFile = env.DATABASE_FILE
    ? path.resolve(ROOT_DIR, env.DATABASE_FILE)
    : path.join(ROOT_DIR, 'data', 'cybersafe.db');

  return {
    rootDir: ROOT_DIR,
    env: nodeEnv,
    isProduction,
    host,
    port,
    appBaseUrl,
    trustProxy: parseBoolean(env.TRUST_PROXY, isProduction),
    database: { file: databaseFile },
    session: {
      // The __Host- prefix is only valid for Secure cookies served from "/".
      cookieName: cookieSecure ? '__Host-cybersafe.sid' : 'cybersafe.sid',
      cookieSecure,
      sameSite: 'lax',
      ttlHours: sessionTtlHours,
    },
    google: {
      status: googleStatus,
      configured: googleStatus === 'configured',
      clientId,
      clientSecret,
      issuer: (env.GOOGLE_ISSUER || 'https://accounts.google.com').trim(),
      redirectUri: (env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/auth/google/callback`).trim(),
    },
    devAuth,
    rateLimits: {
      authWindowMinutes: parseInteger(env.RATE_LIMIT_AUTH_WINDOW_MINUTES, 10),
      authMax: parseInteger(env.RATE_LIMIT_AUTH_MAX, 20),
    },
    warnings,
  };
}

module.exports = { loadConfig, parseBoolean, ROOT_DIR };
