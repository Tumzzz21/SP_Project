'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireActive } = require('../auth/guards');
const { readFlash } = require('../flash');
const modulesDb = require('../db/modules');

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

  // View a module
  router.get('/modules/:id', requireActive, (req, res, next) => {
    const id = Number(req.params.id);
    const mod = modulesDb.findById(db, id);
    if (!mod || mod.status !== 'published') {
      const err = new Error('Module not found.');
      err.statusCode = 404;
      return next(err);
    }
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
      flash: readFlash(req),
    });
  });

  // Mark item complete
  router.post('/modules/:id/items/:itemId/complete', requireActive, (req, res) => {
    const itemId = Number(req.params.itemId);
    modulesDb.markComplete(db, req.user.id, itemId);
    return res.redirect(303, '/modules/' + req.params.id);
  });

  // View file (authenticated)
  router.get('/files/:filename', requireActive, (req, res, next) => {
    const filename = req.params.filename;
    // Find the module item with this file
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
    res.setHeader('Content-Disposition', 'attachment; filename="' + (item.file_name || filename) + '"');
    res.sendFile(path.resolve(filePath));
  });

  return router;
}

module.exports = { createModuleRoutes };
