'use strict';

const crypto = require('node:crypto');
const { AppError } = require('../errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(expected, provided) {
  const a = Buffer.from(String(expected ?? ''));
  const b = Buffer.from(String(provided ?? ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Synchroniser-token CSRF protection.
 *
 * The token lives in the server-side session and must be echoed back in the
 * `_csrf` form field or the `X-CSRF-Token` header. A cross-site page can cause
 * the browser to send the cookie, but it cannot read the token.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Cookie-authenticated requests only. Sign-in itself is protected by the
  // OIDC `state` parameter instead of a CSRF token.
  if (!req.session) return next();

  // Multipart uploads are parsed by multer (route-level), so req.body is
  // empty when this middleware runs. Skip global CSRF for upload routes;
  // the route handlers validate the token after multer parses the body.
  if (req.path === '/settings/profile/photo') return next();
  if (/^\/admin\/modules\/\d+\/items\/upload$/.test(req.path)) return next();

  const provided = req.get('x-csrf-token') || (req.body && req.body._csrf) || '';
  if (!safeEqual(req.session.csrfToken, provided)) {
    return next(
      new AppError(403, 'Your form session has expired. Reload the page and try again.', {
        code: 'csrf_token_invalid',
      }),
    );
  }

  return next();
}

module.exports = { csrfProtection, safeEqual };
