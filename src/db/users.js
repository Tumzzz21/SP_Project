'use strict';

const { AppError } = require('../errors');

const nowIso = () => new Date().toISOString();

const USER_COLUMNS = `
  id,
  google_sub          AS googleSub,
  email,
  email_verified      AS emailVerified,
  username,
  display_name        AS displayName,
  bio,
  avatar_url,
  notification_prefs,
  language,
  text_size,
  role,
  status,
  created_at          AS createdAt,
  updated_at          AS updatedAt,
  last_login_at       AS lastLoginAt,
  setup_completed_at  AS setupCompletedAt
`;

/** @param {any} row */
function toUser(row) {
  if (!row) return null;
  let notificationPrefs = {};
  try {
    notificationPrefs = row.notification_prefs ? JSON.parse(row.notification_prefs) : {};
  } catch (e) {
    // If JSON is invalid, fall back to empty object
    notificationPrefs = {};
  }
  return {
    ...row,
    emailVerified: Boolean(row.emailVerified),
    notification_prefs: notificationPrefs,
    // language and text_size are already strings, no transformation needed
  };
}

/** @param {import('better-sqlite3').Database} db @param {string} googleSub */
function findByGoogleSub(db, googleSub) {
  return toUser(db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`).get(googleSub));
}

/** @param {import('better-sqlite3').Database} db @param {number} id */
function findById(db, id) {
  return toUser(db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id));
}

/** @param {import('better-sqlite3').Database} db @param {string} username */
function findByUsername(db, username) {
  return toUser(
    db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE LOWER(username) = LOWER(?)`).get(username),
  );
}

/** @param {import('better-sqlite3').Database} db @param {string} email */
function findByEmail(db, email) {
  return toUser(db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE LOWER(email) = LOWER(?)`).get(email));
}

/**
 * Create the internal account that a first-time Google sign-in maps to.
 * The account stays `pending_setup` until the student picks a username.
 */
function createPendingUser(db, { googleSub, email, emailVerified = true }) {
  const timestamp = nowIso();
  try {
    const result = db
      .prepare(
        `INSERT INTO users (google_sub, email, email_verified, role, status, created_at, updated_at)
         VALUES (?, ?, ?, 'student', 'pending_setup', ?, ?)`,
      )
      .run(googleSub, email, emailVerified ? 1 : 0, timestamp, timestamp);
    return findById(db, Number(result.lastInsertRowid));
  } catch (error) {
    // Two parallel callbacks for the same Google account: the unique index
    // wins and we simply reuse the row that already exists.
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
      const existing = findByGoogleSub(db, googleSub);
      if (existing) return existing;
    }
    throw error;
  }
}

/** Stable internal subject for a local email+password account (mirrors dev:). */
function localSubFor(email) {
  return `local:${String(email).trim().toLowerCase()}`;
}

/**
 * Create a local (email + password) account. Always a student in
 * `pending_setup`, exactly like a first-time Google sign-in: the student
 * still picks username + display name on /setup. Administrators are never
 * created through this path.
 */
function createLocalUser(db, { email, passwordHash }) {
  const timestamp = nowIso();
  const googleSub = localSubFor(email);
  try {
    const result = db
      .prepare(
        `INSERT INTO users (google_sub, email, email_verified, role, status, created_at, updated_at, password_hash)
         VALUES (?, ?, 0, 'student', 'pending_setup', ?, ?, ?)`,
      )
      .run(googleSub, String(email).trim().toLowerCase(), timestamp, timestamp, passwordHash);
    return findById(db, Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
      const existing = findByGoogleSub(db, googleSub);
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Login lookup: returns the user row together with the password hash for any
 * account that has a password set (created at /register, or seeded locally by
 * scripts/setup-test-accounts.js). Google-only accounts have password_hash
 * NULL and are never returned, so they cannot sign in with a password. The
 * extra column is deliberately NOT part of USER_COLUMNS, so this object must
 * stay inside the auth route — it is never assigned to req.user, rendered,
 * or logged.
 */
function findLocalCredentials(db, email) {
  const row = db
    .prepare(
      `SELECT ${USER_COLUMNS}, password_hash AS passwordHash
         FROM users
        WHERE LOWER(email) = LOWER(?)
          AND password_hash IS NOT NULL`,
    )
    .get(String(email).trim());
  return row ? toUser(row) : null;
}

/**
 * Finish first-time setup: username + display name, then activate.
 * @returns {any} updated user
 */
function completeSetup(db, userId, { username, displayName }) {
  const timestamp = nowIso();
  try {
    const result = db
      .prepare(
        `UPDATE users
            SET username = ?, display_name = ?, status = 'active',
                setup_completed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending_setup'`,
      )
      .run(username, displayName, timestamp, timestamp, userId);
    if (result.changes === 0) {
      throw new AppError(409, 'This account has already finished setup. Open your dashboard instead.', {
        code: 'setup_already_complete',
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      throw new AppError(409, 'That username is already taken. Try another one.', {
        code: 'username_taken',
        details: { username },
      });
    }
    throw error;
  }
  return findById(db, userId);
}

/** Refresh the email Google reports and record the login time. */
function recordLogin(db, userId, { email, emailVerified }) {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE users
        SET email = ?, email_verified = ?, last_login_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(email, emailVerified ? 1 : 0, timestamp, timestamp, userId);
  return findById(db, userId);
}

/** @param {import('better-sqlite3').Database} db @param {number} userId @param {'student'|'admin'} role */
function setRole(db, userId, role) {
  if (role !== 'student' && role !== 'admin') {
    throw new AppError(400, 'Unknown role.', { code: 'invalid_role' });
  }
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), userId);
  return findById(db, userId);
}

/** @param {import('better-sqlite3').Database} db @param {number} userId @param {'active'|'disabled'} status */
function setStatus(db, userId, status) {
  if (status !== 'active' && status !== 'disabled') {
    throw new AppError(400, 'Unknown account status.', { code: 'invalid_status' });
  }
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), userId);
  return findById(db, userId);
}

/** @param {import('better-sqlite3').Database} db @param {number} userId @param {string} displayName */
function updateDisplayName(db, userId, displayName) {
  db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(
    displayName,
    nowIso(),
    userId,
  );
  return findById(db, userId);
}

/**
 * Update the profile fields for a given user.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{display_name?:string, username?:string, bio?:string,
 *          avatar_url?:string, notification_prefs?:Object,
 *          language?:string, text_size?:string}} data
 */
function updateProfile(db, id, data) {
  const set = [];
  const vals = [];

  if (data.display_name !== undefined) {
    set.push('display_name = ?'); vals.push(data.display_name);
  }
  if (data.username !== undefined) {
    // Store empty username as NULL
    const val = data.username === null || data.username === '' ? null : data.username;
    set.push('username = ?'); vals.push(val);
  }
  if (data.bio !== undefined) {
    set.push('bio = ?'); vals.push(data.bio);
  }
  if (data.avatar_url !== undefined) {
    set.push('avatar_url = ?'); vals.push(data.avatar_url);
  }
  if (data.notification_prefs !== undefined) {
    set.push('notification_prefs = ?'); vals.push(JSON.stringify(data.notification_prefs));
  }
  if (data.language !== undefined) {
    set.push('language = ?'); vals.push(data.language);
  }
  if (data.text_size !== undefined) {
    set.push('text_size = ?'); vals.push(data.text_size);
  }

  if (set.length === 0) return; // nothing to change

  vals.push(id);
  const sql = `UPDATE users SET ${set.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...vals);
}

/** Admin user list (used by the Phase 1 admin shell). */
function listUsers(db, { limit = 50 } = {}) {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC LIMIT ?`)
    .all(limit)
    .map(toUser);
}

function countsByRole(db) {
  const rows = db.prepare('SELECT role, status, COUNT(*) AS total FROM users GROUP BY role, status').all();
  const summary = { students: 0, admins: 0, disabled: 0, total: 0 };
  for (const row of rows) {
    summary.total += row.total;
    if (row.role === 'admin') summary.admins += row.total;
    if (row.role === 'student') summary.students += row.total;
    if (row.status === 'disabled') summary.disabled += row.total;
  }
  return summary;
}

/** Student accounts split by status, for the admin dashboard. */
function studentStatusCounts(db) {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS total FROM users WHERE role = 'student' GROUP BY status")
    .all();
  const summary = { active: 0, pendingSetup: 0, disabled: 0, total: 0 };
  for (const row of rows) {
    summary.total += row.total;
    if (row.status === 'active') summary.active += row.total;
    else if (row.status === 'pending_setup') summary.pendingSetup += row.total;
    else if (row.status === 'disabled') summary.disabled += row.total;
  }
  return summary;
}

module.exports = {
  toUser,
  findByGoogleSub,
  findById,
  findByUsername,
  findByEmail,
  createPendingUser,
  localSubFor,
  createLocalUser,
  findLocalCredentials,
  completeSetup,
  recordLogin,
  setRole,
  setStatus,
  updateDisplayName,
  updateProfile,
  listUsers,
  countsByRole,
  studentStatusCounts,
  nowIso,
};
