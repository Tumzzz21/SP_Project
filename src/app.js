'use strict';

const path = require('node:path');
const express = require('express');

const { CATEGORIES } = require('./content/categories');
const { sessionMiddleware } = require('./auth/session');
const { requireActive } = require('./auth/guards');
const { createGoogleClient } = require('./auth/oidc');
const { csrfProtection } = require('./middleware/csrf');
const { requestId, securityHeaders, noStore, createAuthLimiter, createApiLimiter } = require('./middleware/security');
const { errorHandler, notFoundHandler } = require('./middleware/errors');
const { readFlash } = require('./flash');
const { createAuthRoutes } = require('./routes/auth.routes');
const { createPageRoutes } = require('./routes/pages');
const { createLessonRoutes } = require('./routes/lessons');
const { createAttemptRoutes } = require('./routes/attempts');
const { createAdminRoutes } = require('./routes/admin');
const { createModuleRoutes } = require('./routes/modules');
const { createApiRoutes } = require('./routes/api');
const { createSettingsRoutes } = require('./routes/settings');

const VIEWS_DIR = path.join(__dirname, 'views');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

/**
 * Build the Express application. Dependencies are injected so tests can use an
 * in-memory database and a stub OpenID Connect client.
 */
function createApp({ config, db, oidc = null, logger = console }) {
  const app = express();
  const googleClient = oidc || createGoogleClient({ config });

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', VIEWS_DIR);
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(securityHeaders(config));

  app.use(
    express.static(PUBLIC_DIR, {
      etag: true,
      maxAge: config.isProduction ? '1h' : 0,
      index: false,
      redirect: false,
    }),
  );

  const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      maxAge: config.isProduction ? '1h' : 0,
      index: false,
      redirect: false,
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));

  // ---- view locals shared by every template -------------------------------
  app.use((req, res, next) => {
    res.locals.appName = 'CyberSafe';
    res.locals.bodyClass = '';
    res.locals.activeNav = '';
    res.locals.user = null;
    res.locals.csrfToken = null;
    res.locals.flash = [];
    res.locals.categories = CATEGORIES;
    res.locals.currentPath = req.path;
    res.locals.year = new Date().getFullYear();
    res.locals.devAuth = config.devAuth;
    res.locals.googleConfigured = config.google.configured;
    res.locals.formatDate = formatDate;
    res.locals.formatDateTime = formatDateTime;
    next();
  });

  app.use(sessionMiddleware({ db, config }));

  // Browser sessions must not be cached; authenticated JSON must not either.
  app.use(['/dashboard', '/admin', '/account', '/setup', '/api', '/quizzes', '/attempts'], noStore);

  app.use((req, res, next) => {
    res.locals.flash = readFlash(req);
    if (!res.locals.user && req.user) res.locals.user = req.user;
    next();
  });

  // ---- CSRF for cookie-authenticated state changes ------------------------
  app.use(csrfProtection);

  app.use('/api', createApiLimiter(config));

  app.use(createAuthRoutes({ db, config, oidc: googleClient, authLimiter: createAuthLimiter(config) }));
  app.use(createPageRoutes({ db, config }));
  app.use(createLessonRoutes({ db }));
  app.use(createAttemptRoutes({ db }));
  app.use(createAdminRoutes({ db }));
  app.use(createApiRoutes({ db }));
  app.use('/settings', [requireActive], createSettingsRoutes({ db }));

  app.use(createModuleRoutes({ db }));
  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));

  return app;
}

module.exports = { createApp, formatDate, formatDateTime };
