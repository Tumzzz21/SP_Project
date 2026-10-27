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
  content_saved: {
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

/**
 * @param {import('express').Request} req
 * @returns {Array<{type: string, message: string}>}
 */
function readFlash(req) {
  const messages = [];
  for (const parameter of ['notice', 'error']) {
    const code = req.query && req.query[parameter];
    if (typeof code === 'string' && FLASH_MESSAGES[code]) {
      messages.push({ type: FLASH_MESSAGES[code].type, message: FLASH_MESSAGES[code].message });
    }
  }
  return messages;
}

module.exports = { FLASH_MESSAGES, FLASH_CODES, readFlash };
