'use strict';

/**
 * Minimal, deliberately limited content renderer.
 *
 * Lesson bodies are authored by teachers in a tiny subset of Markdown:
 *   `## Heading`, `- bullet`, `> callout`, blank-line separated paragraphs,
 *   `**bold**` and `` `inline code` ``.
 *
 * Every character is HTML-escaped *before* any markup is added, so stored
 * content can never inject scripts or attributes into a page.
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(escapedText) {
  return escapedText
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * @param {string} source
 * @returns {string} safe HTML
 */
function renderLessonContent(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  /** @type {string[]} */
  const html = [];
  let paragraph = [];
  let bullets = [];
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join('');
    html.push(`<ul>${items}</ul>`);
    bullets = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    html.push(`<aside class="callout">${inline(escapeHtml(quote.join(' ')))}</aside>`);
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushQuote();
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (line === '') {
      flushAll();
      continue;
    }

    if (line.startsWith('## ')) {
      flushAll();
      html.push(`<h2>${inline(escapeHtml(line.slice(3)))}</h2>`);
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      flushQuote();
      bullets.push(line.slice(2));
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      flushBullets();
      quote.push(line.slice(2));
      continue;
    }

    flushBullets();
    flushQuote();
    paragraph.push(line);
  }

  flushAll();
  return html.join('\n');
}

module.exports = { renderLessonContent, escapeHtml };
