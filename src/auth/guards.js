'use strict';

const { AppError } = require('../errors');

/** True when the caller expects JSON (API or fetch) rather than a page. */
function wantsJson(req) {
  if (req.path === '/api' || req.path.startsWith('/api/')) return true;
  return req.accepts(['html', 'json']) === 'json';
}

/** Only allow same-site relative redirects; never an absolute URL. */
function safeNextPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

function requireSession(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) {
    return next(new AppError(401, 'Please sign in to continue.', { code: 'sign_in_required' }));
  }
  const nextPath = req.method === 'GET' ? safeNextPath(req.originalUrl, '/dashboard') : null;
  const query = nextPath ? `?next=${encodeURIComponent(nextPath)}` : '';
  return res.redirect(302, `/login${query}`);
}

/**
 * Signed in, setup finished, account enabled.
 * A half-registered account is always pushed to /setup first.
 */
function requireActive(req, res, next) {
  if (!req.user) return requireSession(req, res, next);
  if (req.user.status === 'pending_setup') {
    if (wantsJson(req)) {
      return next(
        new AppError(409, 'Finish setting up your account first.', { code: 'setup_required' }),
      );
    }
    return res.redirect(302, '/setup');
  }
  if (req.user.status !== 'active') {
    return next(new AppError(403, 'This account cannot access CyberSafe right now.', { code: 'account_inactive' }));
  }
  return next();
}

/** @param {'student'|'admin'} role */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return requireSession(req, res, next);
    if (req.user.role !== role) {
      return next(
        new AppError(403, 'You do not have access to that area.', { code: 'insufficient_role' }),
      );
    }
    return next();
  };
}

const requireAdmin = requireRole('admin');
const requireStudent = requireRole('student');

/** Signed-out only pages (login, landing CTA). */
function requireGuest(req, res, next) {
  if (!req.user) return next();
  return res.redirect(302, req.user.role === 'admin' ? '/admin' : '/dashboard');
}

module.exports = { requireSession, requireActive, requireRole, requireAdmin, requireStudent, requireGuest, wantsJson, safeNextPath };
