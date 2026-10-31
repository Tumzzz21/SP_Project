const fs = require('fs');
const c = fs.readFileSync('scripts/seed-demo.js','utf8');
const re = /Q\(/g;
let m;
let idx = 0;
while ((m = re.exec(c)) !== null) {
  let depth = 0, i = m.index;
  let start = i;
  while (i < c.length) {
    if (c[i] === '(') depth++;
    else if (c[i] === ')') { depth--; if (depth === 0) break; }
    i++;
  }
  const call = c.slice(start, i+1);
  const hasOpts = /\[\[/.test(call);
  if (!hasOpts) console.log('NO OPTS at', m.index, call.slice(0,80));
  idx++;
}
console.log('total calls:', idx);