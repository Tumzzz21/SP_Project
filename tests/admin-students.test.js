'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createContext, createUser, login, seedContent } = require('./helpers');

function setupRoles() {
  const ctx = createContext();
  const student = createUser(ctx.db, {});
  const admin = createUser(ctx.db, {
    email: 'admin@example.test',
    username: 'admin1',
    displayName: 'Admin One',
    role: 'admin',
  });
  return {
    ...ctx,
    studentAuth: login(ctx.db, ctx.config, student),
    adminAuth: login(ctx.db, ctx.config, admin),
  };
}

test('admin students report renders for admins and rejects students', async () => {
  const { app, adminAuth, studentAuth } = setupRoles();

  const adminRes = await request(app).get('/admin/students').set('Cookie', adminAuth.cookie);
  assert.equal(adminRes.status, 200);
  assert.match(adminRes.text, /Students/);
  assert.match(adminRes.text, /Modules completed/);

  const studentRes = await request(app).get('/admin/students').set('Cookie', studentAuth.cookie);
  assert.equal(studentRes.status, 403);
});

test('CSV export requires CSRF and admin role', async () => {
  const { app, adminAuth, studentAuth } = setupRoles();

  // Missing CSRF -> 403 even for admin
  const noCsrf = await request(app).get('/admin/students.csv').set('Cookie', adminAuth.cookie);
  assert.equal(noCsrf.status, 403);

  // Student with CSRF -> 403
  const studentCsv = await request(app)
    .get(`/admin/students.csv?_csrf=${studentAuth.csrfToken}`)
    .set('Cookie', studentAuth.cookie);
  assert.equal(studentCsv.status, 403);

  // Admin with CSRF -> 200 with header
  const adminCsv = await request(app)
    .get(`/admin/students.csv?_csrf=${adminAuth.csrfToken}`)
    .set('Cookie', adminAuth.cookie);
  assert.equal(adminCsv.status, 200);
  assert.match(adminCsv.text, /Name,Email,Modules Completed,Overall Progress,Best Score,Last Active/);
});

test('CSV export escapes formula injection', async () => {
  const { app, db, adminAuth } = setupRoles();
  // Insert a user with a formula-like name
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (google_sub, email, email_verified, username, display_name, role, status, created_at, updated_at, setup_completed_at)
     VALUES (?, ?, 1, ?, ?, 'student', 'active', ?, ?, ?)`,
  ).run('sub:evil@test', 'evil@test.com', 'evil', '=CMD|calc', now, now, now);

  const res = await request(app)
    .get(`/admin/students.csv?_csrf=${adminAuth.csrfToken}`)
    .set('Cookie', adminAuth.cookie);
  assert.equal(res.status, 200);
  assert.ok(res.text.includes("'=CMD|calc"), 'formula-prefixed cell must be escaped');
});