'use strict';
const express = require('express');
const { requireActive } = require('../auth/guards');
const { readFlash } = require('../flash');
const users = require('../db/users');
const rateLimit = require('express-rate-limit');
const { hashPassword, verifyPassword } = require('../auth/passwords');

// Helper: flash a message and redirect
function flashAndRedirect(req, res, url, type, msg) {
  if (!req.session) req.session = {};
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ type, message: msg });
  return res.redirect(303, url);
}

// Rate limiter for account endpoints: 5 attempts per 15 minutes per user/IP
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    const isJson = req.path.startsWith('/api/');
    if (isJson) {
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts, please try again later.' } });
    }
    return res.status(429).render('errors/error', {
      pageTitle: 'Too many attempts',
      status: 429,
      title: 'Slow down for a moment',
      message: 'Too many attempts, please try again later.',
      requestId: req.id || '',
      hint: 'Wait a few minutes, then try again.',
    });
  },
});

// Separate rate limiter for security actions (same limits but independent counter)
const securityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    const isJson = req.path.startsWith('/api/');
    if (isJson) {
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts, please try again later.' } });
    }
    return res.status(429).render('errors/error', {
      pageTitle: 'Too many attempts',
      status: 429,
      title: 'Slow down for a moment',
      message: 'Too many attempts, please try again later.',
      requestId: req.id || '',
      hint: 'Wait a few minutes, then try again.',
    });
  },
});

function createSettingsRoutes({ db }) {
  const router = express.Router();

  // ----- GET /settings → redirect to profile -----
  router.get('/', requireActive, (req, res) => {
    return res.redirect(303, '/settings/profile');
  });

  // ----- GET /settings/profile -----
  router.get('/profile', requireActive, (req, res) => {
    res.render('settings', {
      pageTitle: 'Edit Profile | CyberSafe',
      activeSection: 'profile',
      errors: {},
      values: {
        display_name: req.user.displayName || '',
        username: req.user.username || '',
        bio: req.user.bio || '',
      },
      user: req.user,
      csrfToken: req.session ? req.session._csrf : '',
      flash: readFlash(req),
    });
  });

  // ----- POST /settings/profile -----
  router.post('/profile', requireActive, (req, res) => {
    const { display_name, username, bio } = req.body || {};

    // ---- Basic validation (server-side) ----
    const errors = {};

    if (!display_name || display_name.trim() === '') {
      errors.display_name = 'Display name is required.';
    } else if (display_name.length > 50) {
      errors.display_name = 'Display name must be 50 characters or less.';
    }

    if (!username || username.trim() === '') {
      errors.username = 'Username is required.';
    } else {
      const unameRegex = /^[a-zA-Z0-9_]{3,30}$/;
      if (!unameRegex.test(username)) {
        errors.username = 'Username must be 3‑30 chars, letters, numbers, or underscore only.';
      } else {
        // Check uniqueness (excluding the current user)
        const existing = users.findByUsername(db, username);
        if (existing && existing.id !== req.user.id) {
          errors.username = 'That username is already taken.';
        }
      }
    }

    if (bio !== undefined && bio.length > 200) {
      errors.bio = 'Bio must be 200 characters or less.';
    }

    if (Object.keys(errors).length > 0) {
      // Re‑render the form with errors and submitted values
      return res.status(400).render('settings', {
        pageTitle: 'Edit Profile | CyberSafe',
        activeSection: 'profile',
        errors,
        values: { display_name, username, bio },
        user: { ...req.user, display_name, username, bio },
        csrfToken: req.session ? req.session._csrf : '',
        flash: readFlash(req),
      });
    }

    // ---- Persist changes ----
    users.updateProfile(db, req.user.id, {
      display_name: display_name.trim(),
      username: username.trim() === '' ? null : username.trim(),
      bio: bio ? bio.trim() : '',
    });

    // Success feedback
    return flashAndRedirect(
      req,
      res,
      '/settings/profile',
      'success',
      'Profile updated successfully.'
    );
  });

  // ----- GET /settings/account -----
  router.get('/account', requireActive, accountLimiter, (req, res) => {
    // Determine if the user has a password hash (local account)
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const hasPassword = !!row.password_hash;

    res.render('settings', {
      pageTitle: 'Account | CyberSafe',
      activeSection: 'account',
      errors: {},
      values: {}, // no form values to persist for account section
      user: req.user,
      csrfToken: req.session ? req.session._csrf : '',
      flash: readFlash(req),
      hasPassword,
    });
  });

  // ----- POST /settings/account/password -----
  router.post('/account/password', requireActive, accountLimiter, (req, res) => {
    const { current_password, new_password, confirm_password } = req.body || {};

    // Basic validation
    const errors = {};

    if (!current_password || current_password.trim() === '') {
      errors.current_password = 'Current password is required.';
    }

    if (!new_password || new_password.trim() === '') {
      errors.new_password = 'New password is required.';
    } else if (new_password.length < 8) {
      errors.new_password = 'New password must be at least 8 characters.';
    }

    if (!confirm_password || confirm_password.trim() === '') {
      errors.confirm_password = 'Please confirm the new password.';
    } else if (new_password !== confirm_password) {
      errors.confirm_password = 'New passwords do not match.';
    }

    if (Object.keys(errors).length > 0) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      const hasPassword = !!row.password_hash;
      return res.status(400).render('settings', {
        pageTitle: 'Account | CyberSafe',
        activeSection: 'account',
        errors,
        values: {},
        user: req.user,
        csrfToken: req.session ? req.session._csrf : '',
        flash: readFlash(req),
        hasPassword,
      });
    }

    // Verify current password using stored hash
    const credRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const storedHash = credRow ? credRow.password_hash : null;
    if (!storedHash) {
      // Should not happen for a local account, but treat as error
      return flashAndRedirect(req, res, '/settings/account', 'error', 'Unable to verify your credentials.');
    }

    verifyPassword(current_password, storedHash)
      .then((match) => {
        if (!match) {
          errors.current_password = 'Current password is incorrect.';
          const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
          const hasPassword = !!row.password_hash;
          return res.status(400).render('settings', {
            pageTitle: 'Account | CyberSafe',
            activeSection: 'account',
            errors,
            values: {},
            user: req.user,
            csrfToken: req.session ? req.session._csrf : '',
            flash: readFlash(req),
            hasPassword,
          });
        }

        // Hash the new password
        return hashPassword(new_password).then((newHash) => {
          // Update password hash and invalidate all other sessions but keep current one
          return db.transaction(() => {
            // Update password
            db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
              .run(newHash, new Date().toISOString(), req.user.id);

            // Delete other sessions (keep current)
            const currentSessionId = req.session ? req.session.id : null;
            if (currentSessionId) {
              db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
                .run(req.user.id, currentSessionId);
            }
          });
        });
      })
      .then(() => {
        // Success feedback
        return flashAndRedirect(
          req,
          res,
          '/settings/account',
          'success',
          'Password changed successfully.'
        );
      })
      .catch((err) => {
        console.error('Password change error:', err);
        return flashAndRedirect(req, res, '/settings/account', 'error', 'An unexpected error occurred.');
      });
  });

  // ----- POST /settings/account/delete -----
  router.post('/account/delete', requireActive, accountLimiter, (req, res) => {
    const { delete_password, delete_confirmation } = req.body || {};

    // Determine if the user has a password hash (local account)
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const hasPassword = !!row.password_hash;

    // Validation
    const errors = {};

    if (hasPassword) {
      if (!delete_password || delete_password.trim() === '') {
        errors.delete_password = 'Password is required to confirm deletion.';
      }
    } else {
      if (!delete_confirmation || delete_confirmation.trim() !== 'DELETE') {
        errors.delete_confirmation = 'Please type DELETE to confirm account deletion.';
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).render('settings', {
        pageTitle: 'Account | CyberSafe',
        activeSection: 'account',
        errors,
        values: {},
        user: req.user,
        csrfToken: req.session ? req.session._csrf : '',
        flash: readFlash(req),
        hasPassword,
      });
    }

    // Delete avatar file if present
  const avatarPath = req.user.avatar_url;
  if (avatarPath) {
    const fs = require('fs');
    const path = require('path');
    const avatarFile = path.join(__dirname, '..', '..', 'public', avatarPath.replace(/^\/uploads\//, 'uploads/'));
    try { if (fs.existsSync(avatarFile)) fs.unlinkSync(avatarFile); } catch (e) { /* ignore */ }
  }

  // Proceed with deletion inside a transaction
    return db.transaction(() => {
      // Verify password if local account
      if (hasPassword) {
        const credRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
        const storedHash = credRow ? credRow.password_hash : null;
        if (!storedHash) {
          throw new Error('Unable to verify credentials.');
        }
        return verifyPassword(delete_password, storedHash).then((match) => {
          if (!match) {
            throw new Error('Password is incorrect.');
          }
        });
      }
      // For Google-only accounts, no password needed; delete_confirmation already validated.

      // Last‑admin check: count only active admins
      if (req.user.role === 'admin') {
        const adminCountRow = db.prepare(
          'SELECT COUNT(*) AS cnt FROM users WHERE role = ? AND status = ?'
        ).get('admin', 'active');
        const adminCount = adminCountRow ? adminCountRow.cnt : 0;
        if (adminCount <= 1) {
          throw new Error('Cannot delete the last remaining admin.');
        }
      }

      // If foreign_keys is OFF, delete dependent rows manually.
      // We check pragma foreign_keys; if not 1, delete from tables that reference users.
      const fkRow = db.prepare('PRAGMA foreign_keys').get();
      const fkOn = fkRow && fkRow.foreign_keys === 1;
      if (!fkOn) {
        // Delete in order that avoids FK constraints: sessions, lesson_progress, quiz_attempts, attempt_answers
        // attempt_answers depends on quiz_attempts; we delete quiz_attempts first.
        db.prepare('DELETE FROM attempt_answers WHERE quiz_attempt_id IN (SELECT id FROM quiz_attempts WHERE user_id = ?)').run(req.user.id);
        db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(req.user.id);
        db.prepare('DELETE FROM lesson_progress WHERE user_id = ?').run(req.user.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
        // Note: any other tables referencing users should be added here.
      }

      // Finally delete the user
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    })
    .then(() => {
      // Clear session cookie (optional, as user row gone)
      if (res.clearCookie) {
        // Assuming session cookie name is '__Host-session' or similar; we rely on middleware.
        // We'll just destroy the session.
        req.session.destroy(() => {
          return res.redirect(303, '/');
        });
      } else {
        return res.redirect(303, '/');
      }
    })
    .catch((err) => {
      console.error('Account deletion error:', err);
      // Determine if validation error or other
      const msg = err.message || 'An unexpected error occurred.';
      // If it's one of our known validation errors, we want to show form with error.
      // For simplicity, we flash and redirect back.
      return flashAndRedirect(req, res, '/settings/account', 'error', msg);
    });
  });

  // ----- GET /settings/security -----
  router.get('/security', requireActive, securityLimiter, (req, res) => {
    const currentSessionId = req.session ? req.session.id : null;
    const now = new Date().toISOString();
    const rows = db.prepare(
      `SELECT id, user_agent, ip_address, last_seen_at
       FROM sessions
       WHERE user_id = ?
         AND expires_at > ?
       ORDER BY last_seen_at DESC`
    ).all(req.user.id, now);
    const sessions = rows.map(row => ({
      id: row.id,
      device: row.user_agent ? row.user_agent.slice(0, 50) : 'Unknown',
      ip: row.ip_address || 'Unknown',
      lastSeen: row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : 'Never',
      is_current: row.id === currentSessionId
    }));
    res.render('settings', {
      pageTitle: 'Security | CyberSafe',
      activeSection: 'security',
      errors: {},
      values: {},
      user: req.user,
      csrfToken: req.session ? req.session._csrf : '',
      flash: readFlash(req),
      sessions,
    });
  });

  // ----- POST /settings/security/logout-others -----
  router.post('/security/logout-others', requireActive, securityLimiter, (req, res) => {
    const currentSessionId = req.session ? req.session.id : null;
    if (!currentSessionId) {
      // No session? redirect to login or home
      return res.redirect(303, '/');
    }
    return db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
        .run(req.user.id, currentSessionId);
    })
    .then(() => {
      return flashAndRedirect(req, res, '/settings/security', 'success', 'Logged out from other sessions.');
    })
    .catch((err) => {
      console.error('Logout others error:', err);
      return flashAndRedirect(req, res, '/settings/security', 'error', 'Unable to log out other sessions.');
    });
  });

  // ----- GET /settings/notifications -----
  router.get('/notifications', requireActive, (req, res) => {
    res.render('settings', {
      pageTitle: 'Notifications | CyberSafe',
      activeSection: 'notifications',
      errors: {},
      values: {},
      user: req.user,
      csrfToken: req.session ? req.session._csrf : '',
      flash: readFlash(req),
    });
  });

  // ----- POST /settings/notifications -----
  router.post('/notifications', requireActive, (req, res) => {
    const email_reminders = req.body.email_reminders === '1' || req.body.email_reminders === 'on';
    const new_lessons = req.body.new_lessons === '1' || req.body.new_lessons === 'on';
    const quiz_results = req.body.quiz_results === '1' || req.body.quiz_results === 'on';

    users.updateProfile(db, req.user.id, {
      notification_prefs: {
        email_reminders,
        new_lessons,
        quiz_results,
      },
    });

    return flashAndRedirect(req, res, '/settings/notifications', 'success', 'Notification preferences saved.');
  });

  // ----- GET /settings/appearance -----
  router.get('/appearance', requireActive, (req, res) => {
    res.render('settings', {
      pageTitle: 'Appearance | CyberSafe',
      activeSection: 'appearance',
      errors: {},
      values: {},
      user: req.user,
      csrfToken: req.session ? req.session._csrf : '',
      flash: readFlash(req),
    });
  });

  // ----- POST /settings/appearance -----
  router.post('/appearance', requireActive, (req, res) => {
    const language = (req.body.language || 'en').trim();
    const text_size = (req.body.text_size || 'medium').trim();

    const allowedLangs = ['en', 'es', 'fr'];
    const allowedSizes = ['small', 'medium', 'large'];

    if (!allowedLangs.includes(language)) {
      return flashAndRedirect(req, res, '/settings/appearance', 'error', 'Invalid language selection.');
    }
    if (!allowedSizes.includes(text_size)) {
      return flashAndRedirect(req, res, '/settings/appearance', 'error', 'Invalid text size selection.');
    }

    users.updateProfile(db, req.user.id, {
      language,
      text_size,
    });

    return flashAndRedirect(req, res, '/settings/appearance', 'success', 'Appearance settings saved.');
  });

  // ----- POST /settings/profile/photo (upload avatar) -----
  const multer = require('multer');
  const sharp = require('sharp');
  const fs = require('fs');
  const path = require('path');

  const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (req, file, cb) => {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new Error('Only PNG, JPEG, or WebP images are allowed.'));
    },
  });

  router.post('/profile/photo', requireActive, accountLimiter, upload.single('avatar'), async (req, res) => {
    try {
      // Validate CSRF after multer parses the multipart body.
      const csrfModule = require('../middleware/csrf');
      const provided = (req.body && req.body._csrf) || '';
      if (!csrfModule.safeEqual(req.session ? req.session.csrfToken : '', provided)) {
        return flashAndRedirect(req, res, '/settings/profile', 'error', 'Your form session has expired. Reload the page and try again.');
      }
      if (!req.file) {
        return flashAndRedirect(req, res, '/settings/profile', 'error', 'No file uploaded.');
      }

      // Verify magic bytes
      const buf = req.file.buffer;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
                     buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
      if (!isPng && !isJpeg && !isWebp) {
        return flashAndRedirect(req, res, '/settings/profile', 'error', 'Invalid image file.');
      }

      // Delete old avatar if exists
      const oldPath = req.user.avatar_url;
      if (oldPath) {
        const oldFile = path.join(__dirname, '..', '..', 'public', oldPath.replace(/^\/uploads\//, 'uploads/'));
        try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch (e) { /* ignore */ }
      }

      // Resize and re-encode with sharp
      const filename = 'avatar-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.webp';
      const outPath = path.join(uploadDir, filename);
      await sharp(buf).resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toFile(outPath);

      const webPath = '/uploads/avatars/' + filename;
      users.updateProfile(db, req.user.id, { avatar_url: webPath });

      return flashAndRedirect(req, res, '/settings/profile', 'success', 'Profile photo updated.');
    } catch (err) {
      console.error('Photo upload error:', err);
      return flashAndRedirect(req, res, '/settings/profile', 'error', 'Failed to process image.');
    }
  });

  // ----- POST /settings/profile/remove-photo -----
  router.post('/profile/remove-photo', requireActive, accountLimiter, (req, res) => {
    const oldPath = req.user.avatar_url;
    if (oldPath) {
      const oldFile = path.join(__dirname, '..', '..', 'public', oldPath.replace(/^\/uploads\//, 'uploads/'));
      try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch (e) { /* ignore */ }
    }
    users.updateProfile(db, req.user.id, { avatar_url: '' });
    return flashAndRedirect(req, res, '/settings/profile', 'success', 'Profile photo removed.');
  });

  // ----- Mount the router -----
  return router;

}

module.exports = { createSettingsRoutes };