'use strict';

const express = require('express');
const { requireActive, requireAdmin } = require('../auth/guards');
const users = require('../db/users');
const modulesDb = require('../db/modules');
const attemptsDb = require('../db/attempts');
const { readFlash } = require('../flash');
const history = require('../history');

function buildStudentRows(db) {
  const students = users.listUsers(db, { limit: 500 }).filter((u) => u.role === 'student');
  const modules = modulesDb.listPublished(db);
  return students.map((u) => {
    const completedModules = modules.filter((m) => {
      const p = modulesDb.progressForModule(db, u.id, m.id);
      return p.total > 0 && p.completed === p.total;
    }).length;
    const totalItems = modules.reduce((a, m) => a + modulesDb.progressForModule(db, u.id, m.id).total, 0);
    const completedItems = modules.reduce((a, m) => a + modulesDb.progressForModule(db, u.id, m.id).completed, 0);
    const overallPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    const atts = history.decorateHistory(attemptsDb.listForUser(db, u.id));
    const summary = history.summarizeHistory(atts);
    const lastActive = u.last_login_at || (atts.length > 0 ? atts[0].submittedAt || atts[0].startedAt : null);
    return {
      id: u.id,
      name: u.displayName || u.username || u.email,
      email: u.email,
      completedModules,
      totalModules: modules.length,
      overallPercent,
      bestScore: summary.bestPercentage,
      lastActive: u.lastLoginAt || (atts.length > 0 ? atts[0].submittedAt || atts[0].startedAt : null),
    };
  });
}

function escapeCsvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // CSV formula injection mitigation
  if (s.length > 0 && '=+-@'.includes(s.charAt(0))) {
    s = "'" + s;
  }
  // RFC 4180 quoting
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function createAdminStudentsRoutes({ db }) {
  const router = express.Router();
  const guard = [requireActive, requireAdmin];

  router.get('/students', ...guard, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const sort = String(req.query.sort || 'name');
    const dir = req.query.dir === 'desc' ? 'desc' : 'asc';

    let rows = buildStudentRows(db);
    if (q) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
    }
    const cmp = (a, b) => {
      let va, vb;
      switch (sort) {
        case 'email': va = a.email; vb = b.email; break;
        case 'modules': va = a.completedModules; vb = b.completedModules; break;
        case 'progress': va = a.overallPercent; vb = b.overallPercent; break;
        case 'score': va = a.bestScore === null ? -1 : a.bestScore; vb = b.bestScore === null ? -1 : b.bestScore; break;
        case 'lastActive': va = a.lastActive || ''; vb = b.lastActive || ''; break;
        default: va = a.name; vb = b.name;
      }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    };
    rows.sort(cmp);

    res.render('admin/students', {
      pageTitle: 'Students | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      rows,
      q,
      sort,
      dir,
      flash: readFlash(req),
    });
  });

  router.get('/students.csv', ...guard, (req, res) => {
    // CSRF enforcement for export
    const token = req.query._csrf || req.get('x-csrf-token');
    if (!token || token !== (req.session ? req.session.csrfToken : null)) {
      return res.status(403).send('Forbidden');
    }
    const rows = buildStudentRows(db);
    const header = ['Name', 'Email', 'Modules Completed', 'Overall Progress', 'Best Score', 'Last Active'];
    const lines = [header.map(escapeCsvCell).join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.name,
          r.email,
          `${r.completedModules}/${r.totalModules}`,
          `${r.overallPercent}%`,
          r.bestScore === null ? '' : `${r.bestScore}%`,
          r.lastActive || '',
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }
    const csv = lines.join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
    return res.send(csv);
  });

  return router;
}

module.exports = { createAdminStudentsRoutes };