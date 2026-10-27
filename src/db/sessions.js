'use strict';

const crypto = require('node:crypto');
const { toUser } = require('./users');

const nowIso = () => new Date().toISOString();

/** The raw cookie token is never stored; only its SHA-256 digest is. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{userId:number, ttlHours:number, ipAddress?:string|null, userAgent?:string|null, now?:Date}} input
 */
function createSession(db, { userId, ttlHours, ipAddress = null, userAgent = null, now = new Date() }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(hashToken(token), userId, csrfToken, createdAt, expiresAt, createdAt, ipAddress, userAgent);

  return { token, csrfToken, expiresAt };
}

/**
 * Resolve a cookie token to `{ session, user }`. Expired rows are removed.
 * @returns {{session: any, user: any}|null}
 */
function resolveSession(db, token, { now = new Date() } = {}) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id           AS sessionId,
              s.user_id      AS userId,
              s.csrf_token   AS csrfToken,
              s.created_at   AS createdAt,
              s.expires_at   AS expiresAt,
              s.last_seen_at AS lastSeenAt,
              u.id, u.google_sub AS googleSub, u.email, u.email_verified AS emailVerified,
              u.username, u.display_name AS displayName, u.role, u.status,
              u.created_at AS userCreatedAt, u.updated_at AS userUpdatedAt,
              u.last_login_at AS lastLoginAt, u.setup_completed_at AS setupCompletedAt
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(hashToken(token));

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= now.getTime()) {
    deleteSession(db, token);
    return null;
  }

  const user = toUser({
    id: row.id,
    googleSub: row.googleSub,
    email: row.email,
    emailVerified: row.emailVerified,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    createdAt: row.userCreatedAt,
    updatedAt: row.userUpdatedAt,
    lastLoginAt: row.lastLoginAt,
    setupCompletedAt: row.setupCompletedAt,
  });

  return {
    session: {
      id: row.sessionId,
      userId: row.userId,
      csrfToken: row.csrfToken,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastSeenAt: row.lastSeenAt,
    },
    user,
  };
}

/** Sliding expiry: extend once the session is more than half used. */
function extendSession(db, sessionId, expiresAt) {
  db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?').run(
    expiresAt,
    nowIso(),
    sessionId,
  );
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

function deleteSessionById(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function deleteSessionsForUser(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function purgeExpired(db, now = new Date()) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString()).changes;
}

function countActiveSessions(db, userId, now = new Date()) {
  return db
    .prepare('SELECT COUNT(*) AS total FROM sessions WHERE user_id = ? AND expires_at > ?')
    .get(userId, now.toISOString()).total;
}

module.exports = {
  hashToken,
  createSession,
  resolveSession,
  extendSession,
  deleteSession,
  deleteSessionById,
  deleteSessionsForUser,
  purgeExpired,
  countActiveSessions,
};
