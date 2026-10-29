'use strict';

const crypto = require('node:crypto');
const express = require('express');

const { AppError } = require('../errors');
const { createPkcePair } = require('../auth/oidc');
const { setSessionCookie, clearSessionCookie } = require('../auth/session');
const { safeNextPath, wantsJson } = require('../auth/guards');
const { hashPassword, verifyPassword, burnPasswordTime } = require('../auth/passwords');
const {
  validateLoginInput,
  validateRegisterInput,
} = require('../validation');
const users = require('../db/users');
const sessions = require('../db/sessions');

const STATE_TTL_MS = 10 * 60 * 1000;

/** Where a fully registered user belongs after signing in. */
function destinationFor(user) {
  if (user.status === 'pending_setup') return '/setup';
  return user.role === 'admin' ? '/admin' : '/dashboard';
}

function createAuthRoutes({ db, config, oidc, authLimiter }) {
  const router = express.Router();

  router.get('/auth/google/start', authLimiter, async (req, res, next) => {
    try {
      if (!oidc.configured) {
        return res.redirect(303, '/login?error=oauth_not_configured');
      }

      const { verifier, challenge } = createPkcePair();
      const state = crypto.randomBytes(24).toString('base64url');
      const nonce = crypto.randomBytes(24).toString('base64url');
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + STATE_TTL_MS);
      const returnTo = req.query.next ? safeNextPath(String(req.query.next), '/dashboard') : null;

      db.prepare('DELETE FROM oidc_states WHERE expires_at <= ?').run(createdAt.toISOString());
      db.prepare(
        `INSERT INTO oidc_states (state, nonce, code_verifier, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(state, nonce, verifier, returnTo, createdAt.toISOString(), expiresAt.toISOString());

      const url = await oidc.buildAuthorizationUrl({ state, nonce, codeChallenge: challenge });
      return res.redirect(302, url);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/google/callback', authLimiter, async (req, res, next) => {
    try {
      const providerError = req.query.error;
      const code = typeof req.query.code === 'string' ? req.query.code : null;
      const state = typeof req.query.state === 'string' ? req.query.state : null;

      if (providerError === 'access_denied') {
        return res.redirect(303, '/login?error=oauth_cancelled');
      }
      if (!code || !state) {
        return res.redirect(303, '/login?error=oauth_failed');
      }

      // Single use: the row is consumed whether or not the exchange succeeds.
      const record = db
        .prepare('SELECT state, nonce, code_verifier AS codeVerifier, return_to AS returnTo, expires_at AS expiresAt FROM oidc_states WHERE state = ?')
        .get(state);
      db.prepare('DELETE FROM oidc_states WHERE state = ?').run(state);

      if (!record) return res.redirect(303, '/login?error=oauth_expired');
      if (new Date(record.expiresAt).getTime() <= Date.now()) {
        return res.redirect(303, '/login?error=oauth_expired');
      }

      const identity = await oidc.exchangeCodeAndVerify({
        code,
        codeVerifier: record.codeVerifier,
        expectedNonce: record.nonce,
      });

      let user = users.findByGoogleSub(db, identity.googleSub);
      if (!user) {
        // Never auto-link by email: a different Google account that happens
        // to share an email address must not inherit an existing account.
        const emailOwner = users.findByEmail(db, identity.email);
        if (emailOwner) {
          return res.redirect(303, '/login?error=account_conflict');
        }
        user = users.createPendingUser(db, {
          googleSub: identity.googleSub,
          email: identity.email,
          emailVerified: identity.emailVerified,
        });
      }

      if (user.status === 'disabled') {
        sessions.deleteSessionsForUser(db, user.id);
        return res.redirect(303, '/login?error=account_disabled');
      }

      user = users.recordLogin(db, user.id, {
        email: identity.email,
        emailVerified: identity.emailVerified,
      });

      const session = sessions.createSession(db, {
        userId: user.id,
        ttlHours: config.session.ttlHours,
        ipAddress: req.ip,
        userAgent: (req.get('user-agent') || '').slice(0, 255),
      });
      setSessionCookie(res, config, session);

      if (user.status === 'pending_setup') {
        return res.redirect(303, '/setup');
      }
      const nextPath = record.returnTo ? safeNextPath(record.returnTo, destinationFor(user)) : destinationFor(user);
      return res.redirect(303, nextPath);
    } catch (error) {
      if (error instanceof AppError && String(error.code).startsWith('oidc')) {
        const humanCode =
          error.code === 'oidc_email_unverified' ? 'oauth_email_unverified' : 'oauth_failed';
        return res.redirect(303, `/login?error=${humanCode}`);
      }
      return next(error);
    }
  });

  /* ---------------------------------------------------------- password auth
   * Local email + password sign-in alongside Google. Accounts created here
   * are always students in pending_setup (the role field is never read from
   * the body), and the password check happens entirely server-side.
   */

  function renderLoginPage(res, status, extra) {
    return res.status(status).render('login', {
      pageTitle: 'Sign in | CyberSafe',
      bodyClass: 'page-auth',
      next: extra.next || '',
      flash: extra.flash || [],
      devAuth: config.devAuth,
      googleConfigured: config.google.configured,
      values: extra.values || { email: '' },
      errors: extra.errors || {},
      adminMode: Boolean(extra.adminMode),
    });
  }

  router.post('/auth/login', authLimiter, async (req, res, next) => {
    try {
      const { values, errors } = validateLoginInput(req.body || {});
      const nextPath = safeNextPath(String((req.body && req.body.next) || ''), '');
      const adminMode = String((req.body && req.body.adminMode) || '') === '1';

      if (Object.keys(errors).length > 0) {
        return renderLoginPage(res, 400, { values, errors, next: nextPath, adminMode });
      }

      // The same answer for "no such account" and "wrong password", and the
      // same CPU cost (burnPasswordTime) so timing cannot probe which emails
      // are registered.
      // values.password is deliberately always '' (the form never echoes a
      // password back); the submitted one comes straight from the body and is
      // only ever held in this local scope.
      const submittedPassword = String((req.body && req.body.password) || '');
      const credentials = users.findLocalCredentials(db, values.email);
      const stored = credentials ? credentials.passwordHash : null;
      const passwordOk = stored ? await verifyPassword(submittedPassword, stored) : false;
      if (!stored || !passwordOk) {
        if (!stored) await burnPasswordTime(submittedPassword);
        return renderLoginPage(res, 401, {
          values,
          next: nextPath,
          adminMode,
          flash: [{ type: 'error', message: 'Email or password is incorrect. Please try again.' }],
        });
      }

      if (credentials.status === 'disabled') {
        sessions.deleteSessionsForUser(db, credentials.id);
        return res.redirect(303, '/login?error=account_disabled');
      }

      const user = users.recordLogin(db, credentials.id, {
        email: credentials.email,
        emailVerified: Boolean(credentials.emailVerified),
      });

      const session = sessions.createSession(db, {
        userId: user.id,
        ttlHours: config.session.ttlHours,
        ipAddress: req.ip,
        userAgent: (req.get('user-agent') || '').slice(0, 255),
      });
      setSessionCookie(res, config, session);

      if (user.status === 'pending_setup') {
        return res.redirect(303, '/setup');
      }
      return res.redirect(303, nextPath || destinationFor(user));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/auth/register', authLimiter, async (req, res, next) => {
    try {
      const { values, errors } = validateRegisterInput(req.body || {});
      const renderRegister = (status, extra) =>
        res.status(status).render('register', {
          pageTitle: 'Create your account | CyberSafe',
          bodyClass: 'page-auth',
          flash: (extra && extra.flash) || [],
          errors: (extra && extra.errors) || errors,
          values,
          googleConfigured: config.google.configured,
        });

      if (Object.keys(errors).length > 0) {
        return renderRegister(400);
      }

      // Email addresses identify an account across providers: a second row
      // with the same email (Google, dev, or local) must not be created.
      if (users.findByEmail(db, values.email)) {
        return renderRegister(409, {
          errors: {
            ...errors,
            email: 'An account with that email address already exists. Sign in instead.',
          },
        });
      }

      const passwordHash = await hashPassword(req.body.password);
      const user = users.createLocalUser(db, { email: values.email, passwordHash });

      // createLocalUser reuses an existing row on a unique-index race; never
      // open a session unless the stored hash is the one we just produced.
      const credentials = users.findLocalCredentials(db, values.email);
      if (!credentials || credentials.id !== user.id || credentials.passwordHash !== passwordHash) {
        return renderRegister(409, {
          errors: {
            ...errors,
            email: 'An account with that email address already exists. Sign in instead.',
          },
        });
      }

      const session = sessions.createSession(db, {
        userId: user.id,
        ttlHours: config.session.ttlHours,
        ipAddress: req.ip,
        userAgent: (req.get('user-agent') || '').slice(0, 255),
      });
      setSessionCookie(res, config, session);
      return res.redirect(303, '/setup?notice=account_created');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Password reset is intentionally not implemented: no mailer is configured
   * and a fake token flow would be dishonest. The form always answers with
   * the same notice, so it cannot be used to probe which emails are real.
   */
  router.post('/auth/forgot-password', authLimiter, (req, res) => {
    return res.redirect(303, '/forgot-password?notice=reset_unavailable');
  });

  router.post('/auth/logout', (req, res) => {
    if (req.session) {
      sessions.deleteSessionById(db, req.session.id);
    }
    clearSessionCookie(res, config);
    if (wantsJson(req)) {
      return res.status(200).json({ ok: true });
    }
    return res.redirect(303, '/?notice=signed_out');
  });

  /**
   * Development-only sign-in used when Google credentials are not available.
   * It is compiled out of the routing table entirely in production and it
   * always creates student accounts; admin rights come only from the
   * documented server-side promotion script.
   */
  if (config.devAuth) {
    router.post('/auth/dev-login', authLimiter, (req, res, next) => {
      try {
        // `req.body` is undefined when the request arrives with an unexpected
        // content type (only reachable by non-browser clients), so guard it.
        const email = String((req.body && req.body.email) || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || email.length > 254) {
          return res.redirect(303, '/login?error=oauth_failed');
        }

        const googleSub = `dev:${email}`;
        let user = users.findByGoogleSub(db, googleSub);
        if (!user) {
          user = users.createPendingUser(db, { googleSub, email, emailVerified: true });
        }
        if (user.status === 'disabled') {
          return res.redirect(303, '/login?error=account_disabled');
        }

        if (user.status === 'pending_setup') {
          const base = (email.split('@')[0] || 'student').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'student';
          const preferred = base.match(/^[a-z]/) ? base : `user${base}`;
          let username = preferred.length >= 3 ? preferred : `${preferred}student`;
          let suffix = 0;
          while (users.findByUsername(db, username)) {
            suffix += 1;
            username = `${preferred.slice(0, 16)}${suffix}`;
          }
          const displayName = preferred.charAt(0).toUpperCase() + preferred.slice(1);
          user = users.completeSetup(db, user.id, { username, displayName });
        }

        user = users.recordLogin(db, user.id, { email, emailVerified: true });
        // Make dev login accounts admins for easy testing
        if (user.role !== 'admin') {
          users.setRole(db, user.id, 'admin');
        }
        const session = sessions.createSession(db, {
          userId: user.id,
          ttlHours: config.session.ttlHours,
          ipAddress: req.ip,
          userAgent: (req.get('user-agent') || '').slice(0, 255),
        });
        setSessionCookie(res, config, session);

        const nextPath = req.body.next ? safeNextPath(String(req.body.next), destinationFor(user)) : destinationFor(user);
        return res.redirect(303, nextPath);
      } catch (error) {
        return next(error);
      }
    });
  }

  return router;
}

module.exports = { createAuthRoutes, destinationFor };
