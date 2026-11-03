'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireActive } = require('../auth/guards');
const { AppError } = require('../errors');
const { readFlash } = require('../flash');
const modulesDb = require('../db/modules');
const quizzesDb = require('../db/quizzes');

function createModuleRoutes({ db }) {
  const router = express.Router();

  // List published modules
  router.get('/modules', requireActive, (req, res) => {
    const mods = req.user && req.user.role === 'admin'
      ? modulesDb.listForAdmin(db)
      : modulesDb.listPublished(db);
    const withProgress = mods.map(m => ({
      ...m,
      items: modulesDb.moduleProgress(db, req.user.id, m.id),
      quizzes: quizzesDb.listPublishedForModule(db, m.id),
      progress: modulesDb.progressForModule(db, req.user.id, m.id),
    }));
    res.render('modules/index', {
      pageTitle: 'Learning modules | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'learn',
      modules: withProgress,
      user: req.user,
      flash: readFlash(req),
    });
  });

  // View a module. Admins may preview drafts/hidden modules; students only see
  // published ones (a draft link should read "not found", never a 500).
  router.get('/modules/:id', requireActive, (req, res, next) => {
    const id = Number(req.params.id);
    const mod = modulesDb.findById(db, id);
    const isAdmin = Boolean(req.user && req.user.role === 'admin');
    if (!mod || (mod.status !== 'published' && !isAdmin)) {
      return next(new AppError(404, 'That module was not found.', { code: 'module_not_found' }));
    }
    const isPreview = mod.status !== 'published';
    const items = modulesDb.moduleProgress(db, req.user.id, id);
    const progress = modulesDb.progressForModule(db, req.user.id, id);
    // Sequential lock: check if previous items are complete
    let locked = false;
    if (mod.require_sequential) {
      // items are already in order; first incomplete locks the rest
    }
    res.render('modules/show', {
      pageTitle: mod.title + ' | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'learn',
      module: mod,
      items,
      progress,
      preview: isPreview,
      quizzes: quizzesDb.listPublishedForModule(db, id),
      flash: readFlash(req),
    });
  });

  // Mark item complete
  router.post('/modules/:id/items/:itemId/complete', requireActive, (req, res) => {
    const csrfModule = require('../middleware/csrf');
    const provided = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    if (!csrfModule.safeEqual(req.session ? req.session.csrfToken : '', provided)) {
      return res.status(403).send('Forbidden');
    }
    const id = Number(req.params.id);
    const mod = modulesDb.findById(db, id);
    if (!mod || mod.status !== 'published') {
      return res.status(404).send('Not found');
    }
    const itemId = Number(req.params.itemId);
    const item = modulesDb.findItemById(db, itemId);
    if (!item || item.module_id !== id) {
      return res.status(404).send('Not found');
    }
    modulesDb.markComplete(db, req.user.id, itemId);
    return res.redirect(303, '/modules/' + req.params.id);
  });

  // View file (authenticated)
  router.get('/files/:filename', requireActive, (req, res, next) => {
    const filename = req.params.filename;
    const item = db.prepare('SELECT * FROM module_items WHERE file_path = ?').get('uploads/' + filename);
    if (!item) return next(new (require('../errors').AppError)(404, 'File not found.', { code: 'not_found' }));
    const mod = modulesDb.findById(db, item.module_id);
    if (!mod || mod.status !== 'published') {
      return next(new (require('../errors').AppError)(403, 'Access denied.', { code: 'forbidden' }));
    }
    const filePath = path.join(__dirname, '..', '..', 'data', item.file_path);
    if (!fs.existsSync(filePath)) {
      return next(new (require('../errors').AppError)(404, 'File not found.', { code: 'not_found' }));
    }
    const download = req.query.download === '1';
    const disposition = download ? 'attachment' : 'inline';
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'self'");
    res.setHeader('Content-Disposition', disposition + '; filename="' + (item.file_name || filename) + '"');
    res.sendFile(path.resolve(filePath), { acceptRanges: true });
  });

  return router;
}

module.exports = { createModuleRoutes };
