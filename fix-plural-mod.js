const fs = require('fs');
const p = 'src/views/modules/index.ejs';
let c = fs.readFileSync(p, 'utf8');
c = c.replace('items</span>', 'item<%= m.progress.total === 1 ? "" : "s" %></span>');
fs.writeFileSync(p, c);
console.log('DONE');
fs.unlinkSync(__filename);
