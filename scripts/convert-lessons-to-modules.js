const { openDatabase, runMigrations } = require('../src/db');
const modulesDb = require('../src/db/modules');

const TOPICS = [
  { name: 'Phishing', category: 'phishing', quizKeyword: 'phishing' },
  { name: 'Passwords', category: 'passwords', quizKeyword: 'password' },
  { name: 'Scams', category: 'scams', quizKeyword: 'scam' },
  { name: 'Privacy', category: 'privacy', quizKeyword: 'privacy' },
  { name: 'Responsibility', category: 'ethics', quizKeyword: 'ethics' },
];

function main() {
  const db = openDatabase('data/cybersafe.db');
  runMigrations(db);

  console.log('=== BEFORE ===');
  console.log('modules:', db.prepare('SELECT COUNT(*) c FROM modules').get().c);
  console.log('module_items:', db.prepare('SELECT COUNT(*) c FROM module_items').get().c);
  console.log('module_item_progress:', db.prepare('SELECT COUNT(*) c FROM module_item_progress').get().c);

  const lessons = db.prepare("SELECT * FROM lessons WHERE status='published'").all();
  const quizzes = db.prepare("SELECT * FROM quizzes WHERE status='published'").all();

  for (const topic of TOPICS) {
    const existing = db.prepare('SELECT * FROM modules WHERE title = ?').get(topic.name + ' Module');
    if (existing) { console.log('Module already exists for', topic.name, '- skipping'); continue; }

    const mod = modulesDb.createModule(db, {
      title: topic.name + ' Module',
      description: 'Learn about ' + topic.name.toLowerCase() + ' and test your knowledge.',
      status: 'published',
      sortOrder: TOPICS.indexOf(topic),
    });

    const topicLessons = lessons.filter(l => l.category === topic.category);
    for (let i = 0; i < topicLessons.length; i++) {
      const lesson = topicLessons[i];
      modulesDb.addItem(db, {
        moduleId: mod.id, type: 'page', title: lesson.title,
        content: lesson.content || '', sortOrder: i,
      });
    }

    const topicQuiz = quizzes.find(q => q.title && q.title.toLowerCase().includes(topic.quizKeyword));
    if (topicQuiz) {
      modulesDb.addItem(db, {
        moduleId: mod.id, type: 'quiz', title: topicQuiz.title,
        quizId: topicQuiz.id, sortOrder: topicLessons.length,
      });
    }
    console.log('Created module:', mod.id, mod.title, 'with', topicLessons.length, 'lessons', topicQuiz ? '+ quiz' : '');
  }

  const users = db.prepare('SELECT id FROM users').all();
  for (const user of users) {
    const completedLessons = db.prepare("SELECT lp.lesson_id FROM lesson_progress lp WHERE lp.user_id = ? AND lp.completed_at IS NOT NULL").all(user.id);
    for (const cl of completedLessons) {
      const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(cl.lesson_id);
      if (!lesson) continue;
      const item = db.prepare('SELECT id FROM module_items WHERE title = ? AND type = ?').get(lesson.title, 'page');
      if (item) modulesDb.markComplete(db, user.id, item.id);
    }
  }

  console.log('=== AFTER ===');
  console.log('modules:', db.prepare('SELECT COUNT(*) c FROM modules').get().c);
  console.log('module_items:', db.prepare('SELECT COUNT(*) c FROM module_items').get().c);
  console.log('module_item_progress:', db.prepare('SELECT COUNT(*) c FROM module_item_progress').get().c);
  console.log('Published modules:', db.prepare("SELECT COUNT(*) c FROM modules WHERE status='published'").get().c);

  db.close();
}
main();
