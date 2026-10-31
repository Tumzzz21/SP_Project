'use strict';

const express = require('express');
const { requireActive, requireAdmin } = require('../auth/guards');
const users = require('../db/users');
const sessions = require('../db/sessions');
const { readFlash } = require('../flash');

function ensureAuditTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    admin_email TEXT,
    action TEXT NOT NULL,
    target_user_id INTEGER,
    target_email TEXT,
    created_at TEXT NOT NULL
  )`);
}

function logAction(db, admin, action, target) {
  ensureAuditTable(db);
  db.prepare(
    `INSERT INTO admin_audit_log (admin_id, admin_email, action, target_user_id, target_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(admin.id, admin.email, action, target.id, target.email, new Date().toISOString());
}

function activeAdminCount(db) {
  return db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND status = 'active'").get().c;
}

function createAdminUsersRoutes({ db }) {
  const router = express.Router();
  const guard = [requireActive, requireAdmin];

  router.get('/users', ...guard, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    let rows = users.listUsers(db, { limit: 500 });
    if (q) {
      rows = rows.filter((u) => (u.displayName || u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    }
    res.render('admin/users', {
      pageTitle: 'Users | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      rows,
      q,
      flash: readFlash(req),
    });
  });

  function guardSelf(req, res, target) {
    if (target.id === req.user.id) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'You cannot change your own account.' });
      res.redirect(303, '/admin/users');
      return true;
    }
    return false;
  }

  router.post('/users/:id/disable', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const target = users.findById(db, id);
    if (!target) return res.redirect(303, '/admin/users');
    if (guardSelf(req, res, target)) return;
    if (target.role === 'admin' && target.status === 'active' && activeAdminCount(db) <= 1) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Cannot disable the last active admin.' });
      return res.redirect(303, '/admin/users');
    }
    if (req.body._confirm !== '1') {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Confirmation required.' });
      return res.redirect(303, '/admin/users');
    }
    users.setStatus(db, id, 'disabled');
    // destroy sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logAction(db, req.user, 'disable', target);
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type: 'success', message: `${target.displayName || target.username} disabled.` });
    return res.redirect(303, '/admin/users');
  });

  router.post('/users/:id/enable', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const target = users.findById(db, id);
    if (!target) return res.redirect(303, '/admin/users');
    if (req.body._confirm !== '1') {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Confirmation required.' });
      return res.redirect(303, '/admin/users');
    }
    users.setStatus(db, id, 'active');
    logAction(db, req.user, 'enable', target);
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type: 'success', message: `${target.displayName || target.username} enabled.` });
    return res.redirect(303, '/admin/users');
  });

  router.post('/users/:id/demote', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const target = users.findById(db, id);
    if (!target) return res.redirect(303, '/admin/users');
    if (guardSelf(req, res, target)) return;
    if (target.role !== 'admin') {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'User is not an admin.' });
      return res.redirect(303, '/admin/users');
    }
    if (activeAdminCount(db) <= 1) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Cannot demote the last active admin.' });
      return res.redirect(303, '/admin/users');
    }
    if (req.body._confirm !== '1') {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Confirmation required.' });
      return res.redirect(303, '/admin/users');
    }
    users.setRole(db, id, 'student');
    logAction(db, req.user, 'demote', target);
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type: 'success', message: `${target.displayName || target.username} demoted to student.` });
    return res.redirect(303, '/admin/users');
  });

  router.post('/users/:id/promote', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const target = users.findById(db, id);
    if (!target) return res.redirect(303, '/admin/users');
    if (req.body._confirm !== '1') {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Confirmation required.' });
      return res.redirect(303, '/admin/users');
    }
    users.setRole(db, id, 'admin');
    logAction(db, req.user, 'promote', target);
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type: 'success', message: `${target.displayName || target.username} promoted to admin.` });
    return res.redirect(303, '/admin/users');
  });

  return router;
}

module.exports = { createAdminUsersRoutes };