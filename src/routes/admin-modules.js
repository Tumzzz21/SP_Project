'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireActive, requireAdmin } = require('../auth/guards');
const { readFlash } = require('../flash');
const modulesDb = require('../db/modules');
const quizzesDb = require('../db/quizzes');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

function createAdminModuleRoutes({ db }) {
  const router = express.Router();
  const guard = [requireActive, requireAdmin];

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg',
      ];
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new Error('File type not allowed.'));
    },
  });

  const magicBytes = {
    'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
    'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  };

  router.get('/', ...guard, (req, res) => {
    res.render('admin/modules/index', {
      pageTitle: 'Modules | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      modules: modulesDb.listForAdmin(db),
      flash: readFlash(req),
    });
  });

  router.get('/new', ...guard, (req, res) => {
    res.render('admin/modules/form', {
      pageTitle: 'New module | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      module: null,
      flash: readFlash(req),
    });
  });

  router.post('/', ...guard, (req, res) => {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const status = req.body.status === 'published' ? 'published' : 'draft';
    const requireSequential = req.body.require_sequential === '1';
    if (!title) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Title is required.' });
      return res.redirect(303, '/admin/modules/new');
    }
    const mod = modulesDb.createModule(db, { title, description, status, requireSequential });
    return res.redirect(303, '/admin/modules/' + mod.id);
  });

  router.get('/:id', ...guard, (req, res, next) => {
    const id = Number(req.params.id);
    const mod = modulesDb.findById(db, id);
    if (!mod) return next(new (require('../errors').AppError)(404, 'Module not found.', { code: 'not_found' }));
    res.render('admin/modules/form', {
      pageTitle: mod.title + ' | CyberSafe',
      bodyClass: 'page-app',
      activeNav: 'admin',
      module: mod,
      items: modulesDb.listItems(db, id),
      quizzes: quizzesDb.listPublished(db),
      flash: readFlash(req),
    });
  });

  router.post('/:id', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const status = ['draft', 'published', 'hidden'].includes(req.body.status) ? req.body.status : 'draft';
    const requireSequential = req.body.require_sequential === '1';
    if (!title) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Title is required.' });
      return res.redirect(303, '/admin/modules/' + id);
    }
    modulesDb.updateModule(db, id, { title, description, status, requireSequential });
    return res.redirect(303, '/admin/modules/' + id + '?notice=updated');
  });

  router.post('/:id/delete', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const items = modulesDb.listItems(db, id);
    for (const item of items) {
      if (item.file_path) {
        const fp = path.join(__dirname, '..', '..', 'data', item.file_path);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
      }
    }
    modulesDb.deleteModule(db, id);
    return res.redirect(303, '/admin/modules?notice=deleted');
  });
  // Add item
  router.post('/:id/items', ...guard, (req, res) => {
    const moduleId = Number(req.params.id);
    const type = ['page', 'file', 'link', 'quiz'].includes(req.body.type) ? req.body.type : 'page';
    const title = String(req.body.title || '').trim();
    if (!title) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Item title is required.' });
      return res.redirect(303, '/admin/modules/' + moduleId);
    }
    const sortOrder = modulesDb.listItems(db, moduleId).length;
    modulesDb.addItem(db, {
      moduleId,
      type,
      title,
      content: String(req.body.content || ''),
      url: String(req.body.url || '').trim(),
      quizId: req.body.quiz_id ? Number(req.body.quiz_id) : null,
      sortOrder,
    });
    return res.redirect(303, '/admin/modules/' + moduleId + '?notice=item_added');
  });

  // Upload file item
  router.post('/:id/items/upload', ...guard, upload.single('file'), (req, res) => {
    const moduleId = Number(req.params.id);
    if (!req.file) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'No file selected.' });
      return res.redirect(303, '/admin/modules/' + moduleId);
    }
    const buf = req.file.buffer;
    const mime = req.file.mimetype;
    let valid = true;
    if (magicBytes[mime]) valid = magicBytes[mime](buf);
    if (!valid) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', message: 'Invalid file content.' });
      return res.redirect(303, '/admin/modules/' + moduleId);
    }
    const ext = path.extname(req.file.originalname).toLowerCase() || '.bin';
    const filename = 'mod_' + Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
    const outPath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(outPath, buf);
    const title = String(req.body.title || req.file.originalname).trim();
    const sortOrder = modulesDb.listItems(db, moduleId).length;
    modulesDb.addItem(db, {
      moduleId,
      type: 'file',
      title: title || req.file.originalname,
      filePath: 'uploads/' + filename,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      sortOrder,
    });
    return res.redirect(303, '/admin/modules/' + moduleId + '?notice=file_uploaded');
  });

  // Delete item
  router.post('/:id/items/:itemId/delete', ...guard, (req, res) => {
    const moduleId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const item = modulesDb.deleteItem(db, itemId);
    if (item && item.file_path) {
      const fp = path.join(__dirname, '..', '..', 'data', item.file_path);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    }
    return res.redirect(303, '/admin/modules/' + moduleId + '?notice=item_deleted');
  });

  // Publish/hide
  router.post('/:id/publish', ...guard, (req, res) => {
    modulesDb.updateModule(db, Number(req.params.id), { status: 'published' });
    return res.redirect(303, '/admin/modules/' + req.params.id + '?notice=published');
  });
  router.post('/:id/hide', ...guard, (req, res) => {
    modulesDb.updateModule(db, Number(req.params.id), { status: 'hidden' });
    return res.redirect(303, '/admin/modules/' + req.params.id + '?notice=hidden');
  });

  return router;
}

module.exports = { createAdminModuleRoutes };
