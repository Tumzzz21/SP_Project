'use strict';

/**
 * Validation helpers shared by HTML forms and JSON APIs.
 * Every value that leaves this module is already trimmed and normalised.
 */

const { AppError } = require('./errors');

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'staff', 'moderator',
  'cybersafe', 'security', 'teacher', 'instructor', 'null', 'undefined', 'api', 'login',
  'logout', 'signup', 'signin', 'setup', 'dashboard', 'account', 'profile', 'quiz',
  'quizzes', 'lesson', 'lessons', 'learn', 'settings', 'me', 'you', 'google',
]);

const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

/** @param {unknown} value */
function normaliseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{username?: unknown, displayName?: unknown}} input
 * @returns {{values: {username:string, displayName:string}, errors: Record<string,string>}}
 */
function validateSetupInput(input) {
  const usernameRaw = String(input.username ?? '').trim().toLowerCase();
  const displayName = normaliseWhitespace(input.displayName);
  const errors = {};

  if (!usernameRaw) {
    errors.username = 'Choose a username.';
  } else if (!USERNAME_PATTERN.test(usernameRaw)) {
    errors.username =
      'Use 3-20 characters: letters, numbers, or underscore, starting with a letter.';
  } else if (RESERVED_USERNAMES.has(usernameRaw)) {
    errors.username = 'That username is reserved. Please choose another.';
  }

  if (!displayName) {
    errors.displayName = 'Enter the name you want to be known by.';
  } else if (displayName.length < 2 || displayName.length > 60) {
    errors.displayName = 'Display name must be between 2 and 60 characters.';
  // eslint-disable-next-line no-control-regex
  } else if (/[\u0000-\u001f\u007f]/.test(displayName)) {
    errors.displayName = 'Display name contains characters that are not allowed.';
  }

  return { values: { username: usernameRaw, displayName }, errors };
}

/** @param {unknown} value */
function validateDisplayName(value) {
  const displayName = normaliseWhitespace(value);
  if (!displayName) return { value: displayName, error: 'Enter a display name.' };
  if (displayName.length < 2 || displayName.length > 60) {
    return { value: displayName, error: 'Display name must be between 2 and 60 characters.' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(displayName)) {
    return { value: displayName, error: 'Display name contains characters that are not allowed.' };
  }
  return { value: displayName, error: null };
}

/** @param {unknown} value @param {string[]} allowed */
function validateChoice(value, allowed) {
  const candidate = String(value ?? '').trim();
  return allowed.includes(candidate) ? candidate : null;
}

/**
 * JSON API input guard: throws a 400 instead of returning a field map.
 * @param {boolean} condition @param {string} message @param {string} [code]
 */
function assert(condition, message, code = 'invalid_input') {
  if (!condition) throw new AppError(400, message, { code });
}

/* ------------------------------------------------------------------ *
 * Content authoring validation (admin only)
 * ------------------------------------------------------------------ */

/** Lowercase URL slug: letters, digits, single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SLUG_HELP = 'Use lowercase letters, numbers, and hyphens (for example: spotting-phishing).';

/** @param {unknown} value */
function normaliseSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Lesson authoring form.
 * @param {unknown} input
 * @returns {{values: object, errors: Record<string,string>}}
 */
function validateLessonInput(input, { categoryKeys } = {}) {
  const title = normaliseWhitespace(input.title);
  const slug = normaliseSlug(input.slug);
  const summary = String(input.summary ?? '').replace(/\s+/g, ' ').trim();
  const category = String(input.category ?? '').trim();
  const content = String(input.content ?? '').replace(/\r\n/g, '\n').trim();
  const readingRaw = String(input.readingMinutes ?? '').trim();
  const errors = {};

  if (!title) errors.title = 'Enter a lesson title.';
  else if (title.length < 3 || title.length > 120) errors.title = 'Title must be 3-120 characters.';

  if (!slug) errors.slug = 'Enter a URL slug.';
  else if (slug.length < 3 || slug.length > 80) errors.slug = 'Slug must be 3-80 characters.';
  else if (!SLUG_PATTERN.test(slug)) errors.slug = SLUG_HELP;

  if (!summary) errors.summary = 'Enter a short summary.';
  else if (summary.length < 10 || summary.length > 200) errors.summary = 'Summary must be 10-200 characters.';

  const allowedCategories = categoryKeys || [];
  if (!allowedCategories.includes(category)) errors.category = 'Choose a valid category.';

  if (!content) errors.content = 'Enter the lesson content.';
  else if (content.length > 20000) errors.content = 'Lesson content must be 20,000 characters or fewer.';

  const readingMinutes = Number.parseInt(readingRaw, 10);
  if (!Number.isInteger(readingMinutes) || readingMinutes < 1 || readingMinutes > 60) {
    errors.readingMinutes = 'Reading time must be a whole number of minutes between 1 and 60.';
  }

  return {
    values: { title, slug, summary, category, content, readingMinutes: readingMinutes || 4 },
    errors,
  };
}

/**
 * Quiz metadata form (title, description, passing score, slug for new quizzes).
 * @param {unknown} input
 * @returns {{values: object, errors: Record<string,string>}}
 */
function validateQuizInput(input, { requireSlug = true } = {}) {
  const title = normaliseWhitespace(input.title);
  const slug = normaliseSlug(input.slug);
  const description = String(input.description ?? '').replace(/\s+/g, ' ').trim();
  const passRaw = String(input.passingScorePercent ?? '').trim();
  const errors = {};

  if (!title) errors.title = 'Enter a quiz title.';
  else if (title.length < 3 || title.length > 120) errors.title = 'Title must be 3-120 characters.';

  if (requireSlug) {
    if (!slug) errors.slug = 'Enter a URL slug.';
    else if (slug.length < 3 || slug.length > 80) errors.slug = 'Slug must be 3-80 characters.';
    else if (!SLUG_PATTERN.test(slug)) errors.slug = SLUG_HELP;
  }

  if (description.length > 300) errors.description = 'Description must be 300 characters or fewer.';

  const passingScorePercent = passRaw === '' ? 70 : Number.parseInt(passRaw, 10);
  if (!Number.isInteger(passingScorePercent) || passingScorePercent < 0 || passingScorePercent > 100) {
    errors.passingScorePercent = 'Passing score must be a whole number between 0 and 100.';
  }

  return {
    values: { title, slug, description, passingScorePercent },
    errors,
  };
}

const MAX_QUESTIONS_PER_QUIZ = 50;
const MAX_OPTIONS_PER_QUESTION = 6;

/**
 * Parse the quiz question editor body.
 *
 * `express.urlencoded({extended:false})` gives no arrays, so the form posts
 * scalar fields per index: `q_<i>_prompt`, `q_<i>_explanation`,
 * `q_<i>_opt_<j>` (0-based option slots), `q_<i>_correct` (selected slot).
 * Empty trailing option slots are dropped; a question with an empty prompt and
 * no options is skipped entirely (the author cleared it).
 *
 * @param {Record<string, unknown>} body
 * @returns {{questions: Array<{prompt:string, explanation:string,
 *            options:Array<{label:string, isCorrect:boolean}>}>,
 *            blocks: Array<{prompt:string, explanation:string,
 *            optionLabels:string[], correctSlot:number|null}>,
 *            errors: string[]}}
 */
function parseQuestionForm(body) {
  const questions = [];
  const blocks = [];
  const errors = [];

  for (let i = 0; i < MAX_QUESTIONS_PER_QUIZ; i += 1) {
    const prompt = normaliseWhitespace(body[`q_${i}_prompt`]);
    const explanation = normaliseWhitespace(body[`q_${i}_explanation`]);
    const correctRaw = String(body[`q_${i}_correct`] ?? '').trim();

    const optionLabels = [];
    for (let j = 0; j < MAX_OPTIONS_PER_QUESTION; j += 1) {
      optionLabels.push(normaliseWhitespace(body[`q_${i}_opt_${j}`]));
    }

    const touched = prompt || explanation || correctRaw !== '' || optionLabels.some(Boolean);
    if (!touched) continue;

    const correctSlot = Number.parseInt(correctRaw, 10);
    blocks.push({
      prompt,
      explanation,
      optionLabels,
      correctSlot: Number.isInteger(correctSlot) && correctSlot >= 0 ? correctSlot : null,
    });

    const options = optionLabels.filter((label) => label !== '');
    const label = `Question ${i + 1}`;

    if (!prompt) {
      errors.push(`${label}: enter the question prompt.`);
      continue;
    }
    if (prompt.length > 500) {
      errors.push(`${label}: question prompt must be 500 characters or fewer.`);
      continue;
    }
    if (options.length !== 4) {
      errors.push(`${label}: provide exactly four answer options.`);
      continue;
    }
    if (options.some((option) => option.length > 160)) {
      errors.push(`${label}: answer options must be 160 characters or fewer.`);
      continue;
    }
    if (explanation.length > 500) {
      errors.push(`${label}: explanation must be 500 characters or fewer.`);
      continue;
    }

    // The correct marker must point at an option slot that actually has a label.
    if (!Number.isInteger(correctSlot) || correctSlot < 0 || correctSlot > 3) {
      errors.push(`${label}: choose which option is correct (A, B, C, or D).`);
      continue;
    }
    if (!optionLabels[correctSlot]) {
      errors.push(`${label}: the selected correct answer is an empty option.`);
      continue;
    }

    questions.push({
      prompt,
      explanation,
      options: optionLabels.map((optionLabel, slot) => ({
        label: optionLabel,
        isCorrect: slot === correctSlot,
      })),
    });
  }

  if (questions.length === 0 && errors.length === 0) {
    errors.push('Add at least one question before saving.');
  }

  return { questions, blocks, errors };
}

/**
 * Registration form (email + password + confirmation).
 * @param {unknown} input
 * @returns {{values: {email:string, password:string}, errors: Record<string,string>}}
 */
function validateRegisterInput(input) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');
  const confirm = String(input.confirmPassword ?? '');
  const errors = {};

  if (!email) errors.email = 'Enter your email address.';
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!password) errors.password = 'Choose a password.';
  else if (password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (password.length > 200) errors.password = 'Passwords must be 200 characters or fewer.';

  if (password && confirm !== password) {
    errors.confirmPassword = 'Both passwords must match.';
  }

  // Never return the submitted passwords to a rendered form.
  return { values: { email, password: '' }, errors };
}

/**
 * Sign-in form. Kept strict but generic: the route decides whether a failure
 * means "unknown account" or "wrong password" — both answer with the same
 * message so the form cannot be used to probe which emails are registered.
 * @param {unknown} input
 * @returns {{values: {email:string, password:string}, errors: Record<string,string>}}
 */
function validateLoginInput(input) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');
  const errors = {};

  if (!email) errors.email = 'Enter your email address.';
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!password) errors.password = 'Enter your password.';

  return { values: { email, password: '' }, errors };
}

/**
 * Route id helper: positive integer from a path segment, else null.
 * @param {unknown} raw
 * @returns {number|null}
 */
function parseIdParam(raw) {
  const id = Number.parseInt(String(raw), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = {
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  SLUG_PATTERN,
  normaliseWhitespace,
  normaliseSlug,
  validateSetupInput,
  validateDisplayName,
  validateLoginInput,
  validateRegisterInput,
  validateChoice,
  validateLessonInput,
  validateQuizInput,
  parseQuestionForm,
  parseIdParam,
  assert,
};
