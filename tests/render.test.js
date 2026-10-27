'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderLessonContent } = require('../src/content/render');

test('bullets directly under a heading render as a list, not a paragraph', () => {
  const html = renderLessonContent('## Signals\n- First signal\n- Second signal\n\nAfter.');
  assert.match(html, /<h2>Signals<\/h2>/);
  assert.match(html, /<ul><li>First signal<\/li><li>Second signal<\/li><\/ul>/);
  assert.match(html, /<p>After\.<\/p>/);
});

test('inline markup still works inside list items and callouts', () => {
  const html = renderLessonContent('- **Urgent** request\n> Treat it as `hostile`');
  assert.match(html, /<li><strong>Urgent<\/strong> request<\/li>/);
  assert.match(html, /<aside class="callout">Treat it as <code>hostile<\/code><\/aside>/);
});

test('stored HTML is escaped before the renderer adds any markup', () => {
  const html = renderLessonContent('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('paragraphs separated by blank lines stay separate', () => {
  const html = renderLessonContent('One line\nstill one paragraph.\n\nSecond paragraph.');
  assert.match(html, /<p>One line still one paragraph\.<\/p>/);
  assert.match(html, /<p>Second paragraph\.<\/p>/);
});
