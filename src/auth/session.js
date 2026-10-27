'use strict';

const {
  resolveSession,
  extendSession,
  deleteSession,
} = require('../db/sessions');

/** Minimal cookie header parser (avoids an extra dependency). */
function parseCookieHeader(header) {
  /** @type {Record<string,string>} */
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function readSessionToken(req, config) {
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[config.session.cookieName] || null;
}

function cookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.sameSite,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}

/** @param {import('express').Response} res */
function setSessionCookie(res, config, { token, expiresAt }) {
  res.cookie(config.session.cookieName, token, cookieOptions(config, expiresAt));
}

/** @param {import('express').Response} res */
function clearSessionCookie(res, config) {
  res.clearCookie(config.session.cookieName, cookieOptions(config, null));
}

/**
 * Attach `req.user`, `req.session`, `res.locals.user` and `res.locals.csrfToken`.
 * Sessions are opaque tokens validated against the database on every request,
 * so disabling an account or expiring a session takes effect immediately.
 */
function sessionMiddleware({ db, config }) {
  return (req, res, next) => {
    req.user = null;
    req.session = null;

    const token = readSessionToken(req, config);
    if (!token) return next();

    const resolved = resolveSession(db, token);
    if (!resolved) {
      clearSessionCookie(res, config);
      return next();
    }

    // A disabled account must lose access immediately, even if a valid
    // cookie is still in the browser.
    if (resolved.user.status === 'disabled') {
      deleteSession(db, token);
      clearSessionCookie(res, config);
      req.sessionEnded = 'account_disabled';
      return next();
    }

    req.user = resolved.user;
    req.session = resolved.session;
    res.locals.user = resolved.user;
    res.locals.csrfToken = resolved.session.csrfToken;

    // Sliding expiry: refresh the cookie once half of its lifetime is spent.
    const halfLifeMs = (config.session.ttlHours * 60 * 60 * 1000) / 2;
    const remainingMs = new Date(resolved.session.expiresAt).getTime() - Date.now();
    if (remainingMs < halfLifeMs) {
      const expiresAt = new Date(
        Date.now() + config.session.ttlHours * 60 * 60 * 1000,
      ).toISOString();
      extendSession(db, resolved.session.id, expiresAt);
      setSessionCookie(res, config, { token, expiresAt });
    }

    next();
  };
}

module.exports = {
  parseCookieHeader,
  readSessionToken,
  setSessionCookie,
  clearSessionCookie,
  sessionMiddleware,
};
