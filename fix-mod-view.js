const fs = require('fs');
const p = 'src/views/modules/index.ejs';
let c = fs.readFileSync(p, 'utf8');

// Add admin-only "New module" button beside title
c = c.replace(
  `      <h1>Modules</h1>\n      <p class="muted">Structured learning paths with pages, files, links, and quizzes.</p>`,
  `      <h1>Modules</h1>\n      <p class="muted">Structured learning paths with pages, files, links, and quizzes.</p>\n    </div>\n    <% if (user && user.role === 'admin') { %>\n    <div class="page-head-actions">\n      <a class="btn btn-primary btn-sm" href="/admin/modules/new">+ New module</a>\n    </div>\n    <% } %>\n    <div style="display:none">`
);

// Add status badge and Edit link for admins on each row (before the chevron button)
c = c.replace(
  `            <button type="button" class="module-row-chevron"`,
  `            <% if (user && user.role === 'admin') { %>\n            <span class="badge badge-<%= m.status === 'published' ? 'success' : (m.status === 'draft' ? 'warning' : 'outline') %>"><%= m.status %></span>\n            <a href="/admin/modules/<%= m.id %>" class="btn btn-ghost btn-sm">Edit</a>\n            <% } %>\n            <button type="button" class="module-row-chevron"`
);

fs.writeFileSync(p, c);
console.log('DONE');
console.log('has New module:', c.includes('New module'));
console.log('has Edit:', c.includes('Edit'));
