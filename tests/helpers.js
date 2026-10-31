'use strict';

const { createApp } = require('../src/app');
const lessonsDb = require('../src/db/lessons');
const modulesDb = require('../src/db/modules');
const { openDatabase, runMigrations } = require('../src/db');
const sessions = require('../src/db/sessions');

/** Deterministic test configuration (no real credentials anywhere). */
function testConfig(overrides = {}) {
  const base = {
    rootDir: process.cwd(),
    env: 'test',
    isProduction: false,
    host: '127.0.0.1',
    port: 0,
    appBaseUrl: 'http://localhost:3000',
    trustProxy: false,
    database: { file: ':memory:' },
    session: {
      cookieName: 'cybersafe.sid',
      cookieSecure: false,
      sameSite: 'lax',
      ttlHours: 2,
    },
    google: {
      status: 'unconfigured',
      configured: false,
      clientId: '',
      clientSecret: '',
      issuer: 'https://accounts.google.com',
      redirectUri: 'http://localhost:3000/auth/google/callback',
    },
    devAuth: false,
    rateLimits: { authWindowMinutes: 10, authMax: 1000 },
    warnings: [],
  };

  return {
    ...base,
    ...overrides,
    session: { ...base.session, ...(overrides.session || {}) },
    google: { ...base.google, ...(overrides.google || {}) },
    rateLimits: { ...base.rateLimits, ...(overrides.rateLimits || {}) },
  };
}

function createContext({ config, oidc = null } = {}) {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const resolvedConfig = config || testConfig();
  const app = createApp({
    config: resolvedConfig,
    db,
    oidc,
    logger: { error() {}, warn() {}, log() {} },
  });
  return { db, app, config: resolvedConfig };
}

function createUser(
  db,
  { email = 'student@example.test', username = 'student1', displayName = 'Student One', role = 'student', status = 'active' } = {},
) {
  const now = new Date().toISOString();
  const needsUsername = status !== 'pending_setup';
  const result = db
    .prepare(
      `INSERT INTO users
        (google_sub, email, email_verified, username, display_name, role, status, created_at, updated_at, setup_completed_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `sub:${email}`,
      email,
      needsUsername ? username : null,
      needsUsername ? displayName : null,
      role,
      status,
      now,
      now,
      needsUsername ? now : null,
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
}

function login(db, config, user, { ttlHours = 2 } = {}) {
  const session = sessions.createSession(db, { userId: user.id, ttlHours });
  return {
    token: session.token,
    csrfToken: session.csrfToken,
    cookie: `${config.session.cookieName}=${session.token}`,
  };
}

/** One published lesson per category plus a published and a draft quiz. */
function seedContent(db) {
  const now = new Date().toISOString();
  const insertLesson = db.prepare(
    `INSERT INTO lessons (slug, title, summary, category, content, reading_minutes, status, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertLesson.run(
    'phishing-test',
    'Test phishing lesson',
    'A lesson used by the test suite.',
    'phishing',
    '## Heading\n\nBody text with <script>alert(1)</script> and **bold**.',
    4,
    'published',
    now,
    now,
    now,
  );

  const quiz = db
    .prepare(
      `INSERT INTO quizzes (slug, version, title, description, status, passing_score_percent, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('phishing-test-quiz', 1, 'Test quiz', 'A quiz used by the test suite.', 'published', 75, now, now, now);
  const quizId = Number(quiz.lastInsertRowid);

  const insertQuestion = db.prepare(
    'INSERT INTO quiz_questions (quiz_id, position, prompt, explanation, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertOption = db.prepare(
    'INSERT INTO quiz_options (question_id, position, label, is_correct) VALUES (?, ?, ?, ?)',
  );

  const questionId = Number(
    insertQuestion.run(quizId, 1, 'Which signal suggests phishing?', 'Urgency plus a link is a classic sign.', now)
      .lastInsertRowid,
  );
  insertOption.run(questionId, 1, 'A deadline plus a login link', 1);
  insertOption.run(questionId, 2, 'A logo', 0);

  db.prepare(
    `INSERT INTO quizzes (slug, version, title, description, status, passing_score_percent, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('draft-quiz', 1, 'Draft quiz', 'Not visible to students.', 'draft', 70, now, now, null);

  const mod = modulesDb.createModule(db, { title: 'Test module', description: 'A module used by the test suite.', status: 'published', sortOrder: 0 });
  const item = modulesDb.addItem(db, { moduleId: mod.id, type: 'page', title: 'Test module item', content: 'Body', sortOrder: 0 });

  return { quizId, questionId, lessonSlug: 'phishing-test', quizSlug: 'phishing-test-quiz', moduleId: mod.id, itemId: item.id };
}

module.exports = { testConfig, createContext, createUser, login, seedContent };
