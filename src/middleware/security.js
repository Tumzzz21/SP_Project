'use strict';

const crypto = require('node:crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/** Attach a request id for logs and error pages (never a secret). */
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

function securityHeaders(config) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'style-src': ["'self'"],
        'script-src': ["'self'"],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        ...(config.isProduction ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction ? undefined : false,
  });
}

/** Authenticated pages must never be cached by a shared machine's browser. */
function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  next();
}

function limiterHandler(message) {
  return (req, res) => {
    const isJson = req.path.startsWith('/api/');
    if (isJson) {
      return res.status(429).json({ error: { code: 'rate_limited', message } });
    }
    return res.status(429).render('errors/error', {
      pageTitle: 'Too many attempts',
      status: 429,
      title: 'Slow down for a moment',
      message,
      requestId: req.id,
      hint: 'Wait a few minutes, then try again.',
    });
  };
}

function createAuthLimiter(config) {
  return rateLimit({
    windowMs: config.rateLimits.authWindowMinutes * 60 * 1000,
    limit: config.rateLimits.authMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: limiterHandler('Too many sign-in attempts. Please wait and try again.'),
  });
}

function createApiLimiter(config) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: limiterHandler('Too many requests. Please slow down.'),
  });
}

module.exports = { requestId, securityHeaders, noStore, createAuthLimiter, createApiLimiter };
