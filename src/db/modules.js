'use strict';

const nowIso = () => new Date().toISOString();

function createModule(db, { title, description = '', status = 'draft', sortOrder = 0, requireSequential = false }) {
  const now = nowIso();
  const result = db.prepare(
    `INSERT INTO modules (title, description, status, sort_order, require_sequential, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(title, description, status, sortOrder, requireSequential ? 1 : 0, now, now, status === 'published' ? now : null);
  return findById(db, Number(result.lastInsertRowid));
}

function findById(db, id) {
  return db.prepare('SELECT * FROM modules WHERE id = ?').get(id) || null;
}

function listForAdmin(db) {
  return db.prepare('SELECT * FROM modules ORDER BY sort_order, id').all();
}

function listPublished(db) {
  return db.prepare("SELECT * FROM modules WHERE status = 'published' ORDER BY sort_order, id").all();
}

function updateModule(db, id, { title, description, status, sortOrder, requireSequential, coverImage }) {
  const now = nowIso();
  const fields = [];
  const vals = [];
  if (title !== undefined) { fields.push('title = ?'); vals.push(title); }
  if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
  if (status !== undefined) {
    fields.push('status = ?'); vals.push(status);
    if (status === 'published') {
      fields.push('published_at = COALESCE(published_at, ?)'); vals.push(now);
    }
  }
  if (sortOrder !== undefined) { fields.push('sort_order = ?'); vals.push(sortOrder); }
  if (requireSequential !== undefined) { fields.push('require_sequential = ?'); vals.push(requireSequential ? 1 : 0); }
  if (coverImage !== undefined) { fields.push('cover_image = ?'); vals.push(coverImage); }
  fields.push('updated_at = ?'); vals.push(now);
  vals.push(id);
  db.prepare(`UPDATE modules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return findById(db, id);
}

function deleteModule(db, id) {
  db.prepare('DELETE FROM modules WHERE id = ?').run(id);
}

function addItem(db, { moduleId, type, title, content = '', url = '', filePath = '', fileName = '', fileSize = 0, quizId = null, sortOrder = 0 }) {
  const now = nowIso();
  const result = db.prepare(
    `INSERT INTO module_items (module_id, type, title, content, url, file_path, file_name, file_size, quiz_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(moduleId, type, title, content, url, filePath, fileName, fileSize, quizId, sortOrder, now, now);
  return findItemById(db, Number(result.lastInsertRowid));
}

function findItemById(db, id) {
  return db.prepare('SELECT * FROM module_items WHERE id = ?').get(id) || null;
}

function listItems(db, moduleId) {
  return db.prepare('SELECT * FROM module_items WHERE module_id = ? ORDER BY sort_order, id').all(moduleId);
}

function updateItem(db, id, data) {
  const now = nowIso();
  const fields = [];
  const vals = [];
  if (data.title !== undefined) { fields.push('title = ?'); vals.push(data.title); }
  if (data.type !== undefined) { fields.push('type = ?'); vals.push(data.type); }
  if (data.content !== undefined) { fields.push('content = ?'); vals.push(data.content); }
  if (data.url !== undefined) { fields.push('url = ?'); vals.push(data.url); }
  if (data.filePath !== undefined) { fields.push('file_path = ?'); vals.push(data.filePath); }
  if (data.fileName !== undefined) { fields.push('file_name = ?'); vals.push(data.fileName); }
  if (data.fileSize !== undefined) { fields.push('file_size = ?'); vals.push(data.fileSize); }
  if (data.quizId !== undefined) { fields.push('quiz_id = ?'); vals.push(data.quizId); }
  if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); vals.push(data.sortOrder); }
  fields.push('updated_at = ?'); vals.push(now);
  vals.push(id);
  db.prepare(`UPDATE module_items SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return findItemById(db, id);
}

function deleteItem(db, id) {
  const item = findItemById(db, id);
  db.prepare('DELETE FROM module_items WHERE id = ?').run(id);
  return item;
}

function markComplete(db, userId, itemId) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO module_item_progress (user_id, item_id, completed_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, item_id) DO NOTHING`
  ).run(userId, itemId, now);
}

function isComplete(db, userId, itemId) {
  const row = db.prepare('SELECT 1 FROM module_item_progress WHERE user_id = ? AND item_id = ?').get(userId, itemId);
  return !!row;
}

function progressForModule(db, userId, moduleId) {
  const items = listItems(db, moduleId);
  const completed = items.filter(item => isComplete(db, userId, item.id)).length;
  return { total: items.length, completed, percent: items.length > 0 ? Math.round((completed / items.length) * 100) : 0 };
}

function moduleProgress(db, userId, moduleId) {
  const items = listItems(db, moduleId);
  const completedIds = new Set(
    db.prepare('SELECT item_id FROM module_item_progress WHERE user_id = ?').all(userId).map(r => r.item_id)
  );
  return items.map(item => ({ ...item, completed: completedIds.has(item.id) }));
}

function countsByStatus(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS total FROM modules GROUP BY status').all();
  const summary = { draft: 0, published: 0, archived: 0, total: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) summary[row.status] = row.total;
    summary.total += row.total;
  }
  return summary;
}
function moveModule(db, id, direction) {
  const mod = findById(db, id);
  if (!mod) return;
  const mods = listForAdmin(db);
  const idx = mods.findIndex(m => m.id === id);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= mods.length) return;
  const other = mods[swapIdx];
  db.prepare('UPDATE modules SET sort_order = ? WHERE id = ?').run(other.sort_order, mod.id);
  db.prepare('UPDATE modules SET sort_order = ? WHERE id = ?').run(mod.sort_order, other.id);
}

function moveItem(db, id, direction) {
  const item = findItemById(db, id);
  if (!item) return;
  const items = listItems(db, item.module_id);
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  const other = items[swapIdx];
  db.prepare('UPDATE module_items SET sort_order = ? WHERE id = ?').run(other.sort_order, item.id);
  db.prepare('UPDATE module_items SET sort_order = ? WHERE id = ?').run(item.sort_order, other.id);
}

module.exports = {
  createModule, findById, listForAdmin, listPublished, updateModule, deleteModule, moveModule,
  countsByStatus,
  addItem, findItemById, listItems, updateItem, deleteItem, moveItem,
  markComplete, isComplete, progressForModule, moduleProgress,
};
