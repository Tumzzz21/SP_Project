'use strict';

/**
 * Repository-wide guard against double-encoded UTF-8 ("mojibake").
 *
 * A file that was once UTF-8 but got decoded as Windows-1252 and re-saved as
 * UTF-8 doubles every multi-byte character: the middle dot (U+00B7, bytes
 * C2 B7) becomes U+00C2 U+00B7 (bytes C3 82 C2 B7), and the right arrow
 * becomes U+00E2 U+2020 U+2019. The signatures below are written with escapes
 * only, so this checker can never flag itself. Each hit reports the exact byte
 * sequence found, which is what tells you whether you are looking at a stray
 * BOM or a full mojibake pair.
 *
 *   node scripts/check-encoding.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'public', 'scripts', 'tests', 'supabase'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'coverage']);
const TEXT_FILE = /\.(ejs|js|css|md|json|sql|bat|cmd)$/i;

const MOJIBAKE = new RegExp(
  [
    // U+00C2 followed by a continuation-ish byte (middle dot, NBSP, guillemet).
    '[\\u00C2][\\u0080-\\u00BF\\u00A0\\u2018-\\u203A ]',
    // U+00E2 followed by a continuation byte or curly punctuation (arrow, dash).
    '[\\u00E2][\\u0080-\\u00BF\\u2018-\\u203A]',
    // U+00C3 followed by a continuation byte (accented Latin-1 letters).
    '[\\u00C3][\\u0080-\\u00BF]',
    // A UTF-8 BOM decoded as ANSI (three Latin-1 characters).
    '[\\u00EF][\\u00BB][\\u00BF]',
    // Unicode replacement character.
    '\\uFFFD',
  ].join('|'),
  'g',
);

/** UTF-8 bytes of a string, space separated and uppercase. */
function toHex(value) {
  return Buffer.from(value, 'utf8')
    .toString('hex')
    .toUpperCase()
    .replace(/(..)(?=.)/g, '$1 ');
}

/** Code points of a string, e.g. "U+2192". */
function toCodePoints(value) {
  return Array.from(value, (character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

/**
 * Every mojibake sequence in one file.
 * @param {string} file absolute path
 * @returns {Array<{file:string,line:number,column:number,bytes:string,codePoints:string,text:string}>}
 */
function scanFile(file) {
  const hits = [];
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    MOJIBAKE.lastIndex = 0;
    let match;
    while ((match = MOJIBAKE.exec(line)) !== null) {
      hits.push({
        file,
        line: index + 1,
        column: match.index + 1,
        bytes: toHex(match[0]),
        codePoints: toCodePoints(match[0]),
        text: line.trim().slice(0, 120),
      });
    }
  });
  return hits;
}

/**
 * Every mojibake sequence under the scanned roots.
 * @param {{root?:string, roots?:string[]}} [options]
 */
function scan({ root = ROOT, roots = SCAN_ROOTS } = {}) {
  const hits = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(full);
        continue;
      }
      if (!TEXT_FILE.test(entry.name)) continue;
      hits.push(...scanFile(full));
    }
  };
  for (const name of roots) {
    const start = path.join(root, name);
    if (fs.existsSync(start)) visit(start);
  }
  return hits;
}

/** @returns {number} process exit code */
function main() {
  const hits = scan();
  if (hits.length === 0) {
    console.log(`Encoding check passed: no mojibake in ${SCAN_ROOTS.join(', ')}.`);
    return 0;
  }
  console.error(`Mojibake found in ${hits.length} place(s):`);
  for (const hit of hits) {
    console.error(`  ${path.relative(ROOT, hit.file)}:${hit.line}:${hit.column}  ${hit.bytes}  (${hit.codePoints})`);
    console.error(`    ${hit.text}`);
  }
  console.error('\nRe-save these files as UTF-8 (no BOM) and replace the corrupted characters.');
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { scan, scanFile, main, MOJIBAKE, SCAN_ROOTS };
