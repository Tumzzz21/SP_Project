const db = require('./src/db').openDatabase('data/cybersafe.db');
console.log('sessions fk:', JSON.stringify(db.prepare('PRAGMA foreign_key_list(sessions)').all()));
console.log('attempts for quiz 4:', db.prepare('SELECT COUNT(*) c FROM quiz_attempts WHERE quiz_id=4').get().c);
console.log('attempts for quiz 2:', db.prepare('SELECT COUNT(*) c FROM quiz_attempts WHERE quiz_id=2').get().c);
console.log('attempts:', JSON.stringify(db.prepare('SELECT id,user_id,quiz_id FROM quiz_attempts').all()));
console.log('sessions:', JSON.stringify(db.prepare('SELECT id,user_id FROM sessions').all()));