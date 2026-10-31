const fs = require('fs');
const p = 'src/routes/pages.js';
let c = fs.readFileSync(p, 'utf8');
const old = "    const quizzes = quizzesDb.listPublished(db);\r\n    const counts = quizzesDb.questionCounts(db, quizzes.map((quiz) => quiz.id));\r\n    const adminView = req.user.role === 'admin';";
const neu = "    const quizzes = req.user.role === 'admin'\r\n      ? quizzesDb.listForAdmin(db)\r\n      : quizzesDb.listPublished(db);\r\n    const counts = quizzesDb.questionCounts(db, quizzes.map((quiz) => quiz.id));\r\n    const adminView = req.user.role === 'admin';";
if (!c.includes(old)) { console.log('NOT FOUND'); process.exit(1); }
c = c.replace(old, neu);

// Add user to render call
const old2 = "      adminView,\r\n      flash: readFlash(req),\r\n    });";
const neu2 = "      adminView,\r\n      user: req.user,\r\n      flash: readFlash(req),\r\n    });";
if (c.includes(old2)) c = c.replace(old2, neu2);

fs.writeFileSync(p, c);
console.log('FIXED');
fs.unlinkSync(__filename);
