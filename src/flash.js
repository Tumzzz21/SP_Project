'use strict';

/**
 * Short, allow-listed messages passed through the URL, e.g. `?error=session_expired`.
 * Only known codes are rendered, so the query string can never inject text.
 */
const FLASH_MESSAGES = {
  session_expired: {
    type: 'warning',
    message: 'Your session expired. Please sign in again to continue.',
  },
  signed_out: { type: 'success', message: 'You have been signed out.' },
  account_disabled: {
    type: 'error',
    message: 'This account has been disabled. Contact your instructor or the site administrator.',
  },
  oauth_not_configured: {
    type: 'warning',
    message:
      'Google sign-in is not configured on this server yet. An administrator must add the Google OAuth credentials.',
  },
  oauth_failed: {
    type: 'error',
    message: 'Sign-in could not be completed. Please try again.',
  },
  oauth_expired: {
    type: 'warning',
    message: 'That sign-in attempt expired. Please start again.',
  },
  oauth_cancelled: { type: 'warning', message: 'Sign-in was cancelled.' },
  oauth_email_unverified: {
    type: 'error',
    message: 'Your Google email address must be verified before you can use CyberSafe.',
  },
  account_conflict: {
    type: 'error',
    message:
      'This Google account does not match the CyberSafe account already registered with that email. Contact the administrator.',
  },
  setup_required: {
    type: 'warning',
    message: 'Finish your account setup to continue.',
  },
  username_taken: {
    type: 'error',
    message: 'That username was just taken. Please choose another one.',
  },
  display_name_updated: { type: 'success', message: 'Your display name has been updated.' },
  setup_complete: {
    type: 'success',
    message: 'Your CyberSafe account is ready. Welcome aboard.',
  },
  forbidden: {
    type: 'error',
    message: 'You do not have access to that area.',
  },
  lesson_completed: {
    type: 'success',
    message: 'Lesson marked complete. Your progress is saved to your account.',
  },
  lesson_reopened: {
    type: 'success',
    message: 'Lesson completion removed. You can mark it complete again at any time.',
  },
  attempt_resumed: {
    type: 'warning',
    message: 'You already had an attempt in progress, so it has been reopened.',
  },
  attempt_submitted: {
    type: 'success',
    message: 'Attempt submitted and graded. Review the explanations below.',
  },
  already_submitted: {
    type: 'warning',
    message: 'That attempt was already submitted. Your saved result is shown below.',
  },
  attempt_expired: {
    type: 'warning',
    message: 'That attempt expired before it was submitted. Start the quiz again when you are ready.',
  },
  lesson_saved: {
    type: 'success',
    message: 'Lesson saved as a draft. Publish it when you are ready for students to see it.',
  },
  lesson_updated: {
    type: 'success',
    message: 'Lesson updated. Students see the new content right away if it is published.',
  },
  lesson_published: {
    type: 'success',
    message: 'Lesson published. It now appears in the Learning Center.',
  },
  lesson_unpublished: {
    type: 'success',
    message: 'Lesson unpublished. It is hidden from students, but their progress is kept.',
  },
  lesson_archived: {
    type: 'success',
    message: 'Lesson archived. It is hidden from students and their progress history is kept.',
  },
  quiz_created: {
    type: 'success',
    message: 'Quiz created as a draft. Add questions, then publish it.',
  },
  quiz_updated: {
    type: 'success',
    message: 'Draft quiz updated.',
  },
  quiz_questions_saved: {
    type: 'success',
    message: 'Questions saved to the draft. Publish when you are ready for students.',
  },
  quiz_published: {
    type: 'success',
    message: 'Quiz version published. Students can take it now.',
  },
  quiz_archived: {
    type: 'success',
    message: 'Quiz version retired. Existing attempt history is unchanged.',
  },
  quiz_restored: {
    type: 'success',
    message: 'Quiz version restored to the active catalogue.',
  },
  quiz_deleted: {
    type: 'success',
    message: 'Archived quiz version deleted. No student attempts were attached to it.',
  },
  quiz_has_attempts: {
    type: 'error',
    message:
      'This quiz version has student attempts and cannot be deleted. Keep it archived to preserve their history.',
  },
  quiz_not_archived: {
    type: 'error',
    message: 'Only archived quiz versions can be restored or deleted.',
  },
  quiz_restore_invalid: {
    type: 'error',
    message:
      'This archived version cannot be published again because its question set is incomplete. Create a new version instead.',
  },
  quiz_restore_unsafe: {
    type: 'error',
    message:
      'This archived version has student attempts and cannot be made editable again. Create a new version instead.',
  },
  quiz_version_created: {
    type: 'success',
    message: 'New draft version created from the published one. Edit it, then publish.',
  },
  quiz_draft_exists: {
    type: 'warning',
    message: 'This quiz already has an unpublished draft version. Edit that one instead.',
  },
  slug_taken: {
    type: 'error',
    message: 'That slug is already in use. Pick a different one.',
  },
  quiz_not_editable: {
    type: 'error',
    message: 'Published quiz versions are immutable. Create a new draft version to make changes.',
  },
  module_title_required: {
    type: 'error',
    message: 'Enter a module title.',
  },
  module_item_title_required: {
    type: 'error',
    message: 'Enter a title for the item.',
  },
  csrf_expired: {
    type: 'error',
    message: 'Your form session has expired. Reload the page and try again.',
  },
  upload_failed: {
    type: 'error',
    message: 'That file could not be uploaded. Use a PDF, PPTX, DOCX, PNG or JPG under 20 MB.',
  },
  no_file: {
    type: 'error',
    message: 'Choose a file to upload.',
  },
  invalid_file: {
    type: 'error',
    message: 'That file content is not a valid PDF, image, or Office document.',
  },  module_created: {
    type: 'success',
    message: 'Module created. It is listed below — open it to add more content.',
  },
  module_created_with_file: {
    type: 'success',
    message: 'Module created with its first handout attached. It is listed below.',
  },
  updated: {
    type: 'success',
    message: 'Module details saved.',
  },
  item_added: {
    type: 'success',
    message: 'Item added to the module.',
  },
  file_uploaded: {
    type: 'success',
    message: 'File uploaded and added to the module.',
  },
  item_deleted: {
    type: 'success',
    message: 'Item removed from the module.',
  },
  published: {
    type: 'success',
    message: 'Module published. Students can open it now.',
  },
  hidden: {
    type: 'warning',
    message: 'Module hidden. Students can no longer open it; their progress is kept.',
  },
  deleted: {
    type: 'success',
    message: 'Module deleted.',
  },  content_saved: {
    type: 'success',
    message: 'Changes saved.',
  },
  invalid_credentials: {
    type: 'error',
    message: 'Email or password is incorrect. Please try again.',
  },
  account_created: {
    type: 'success',
    message: 'Your account was created. Choose a username to finish setting it up.',
  },
  reset_unavailable: {
    type: 'warning',
    message:
      'Password reset emails are not configured on this site yet. Ask your instructor or the administrator to reset your password.',
  },
};

const FLASH_CODES = Object.keys(FLASH_MESSAGES);

const FLASH_COOKIE = 'cybersafe.flash';
const FLASH_TYPES = new Set(['success', 'error', 'warning', 'info']);

/** @param {string} header raw Cookie header */
function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[name] = part.slice(index + 1).trim();
    }
  }
  return out;
}

/**
 * Messages an earlier request parked in the flash cookie. The session object is
 * a read-only database row, so `req.session.flash` never persisted; a short
 * lived cookie carries those messages across one redirect instead.
 * @param {import('express').Request} req
 */
function readFlashCookie(req) {
  const raw = parseCookieHeader(req && req.headers ? req.headers.cookie : '')[FLASH_COOKIE];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.message === 'string' && FLASH_TYPES.has(item.type))
      .slice(0, 3)
      .map((item) => ({ type: item.type, message: item.message }));
  } catch {
    return [];
  }
}

/**
 * @param {import('express').Request} req
 * @returns {Array<{type: string, message: string}>}
 */
function readFlash(req) {
  const messages = readFlashCookie(req);
  for (const parameter of ['notice', 'error']) {
    const code = req.query && req.query[parameter];
    if (typeof code === 'string' && FLASH_MESSAGES[code]) {
      messages.push({ type: FLASH_MESSAGES[code].type, message: FLASH_MESSAGES[code].message });
    }
  }
  return messages;
}

module.exports = { FLASH_MESSAGES, FLASH_CODES, FLASH_COOKIE, readFlash, readFlashCookie };
