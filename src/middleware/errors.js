'use strict';

const { AppError } = require('../errors');
const { wantsJson } = require('../auth/guards');
const { readFlash } = require('../flash');

const STATUS_COPY = {
  400: { title: 'That request could not be accepted', hint: 'Check the details and try again.' },
  401: { title: 'Please sign in', hint: 'Your session may have ended.' },
  403: { title: 'Access denied', hint: 'This area belongs to a different account type or role.' },
  404: { title: 'Page not found', hint: 'The link may be old, or the page may have moved.' },
  409: { title: 'That did not go through', hint: 'The page was out of date. Reload and try again.' },
  429: { title: 'Too many requests', hint: 'Wait a moment, then try again.' },
  500: { title: 'Something went wrong', hint: 'The problem has been logged. Please try again.' },
  503: { title: 'Service unavailable', hint: 'A required service is not configured or unreachable.' },
};

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'We could not find that page.', { code: 'not_found' }));
}

/**
 * Single error boundary. Client errors show their message; server errors show
 * a generic message and keep details in the server log only.
 */
function errorHandler({ logger = console } = {}) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const isAppError = err instanceof AppError;
    const status = isAppError ? err.statusCode : 500;
    const requestId = req.id || 'unknown';

    if (status >= 500) {
      logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} failed (${err.code || 'unhandled'}): ${err.message}`,
      );
    }

    const copy = STATUS_COPY[status] || STATUS_COPY[500];
    const message =
      status >= 500
        ? 'An unexpected error stopped that page from loading.'
        : isAppError
          ? err.message
          : copy.title;

    if (wantsJson(req)) {
      return res.status(status).json({
        error: {
          code: isAppError ? err.code : 'internal_error',
          message,
          requestId,
        },
      });
    }

    const flash = readFlash(req);
    return res.status(status).render('errors/error', {
      pageTitle: `${copy.title} | CyberSafe`,
      status,
      title: copy.title,
      message,
      hint: copy.hint,
      requestId,
      flash,
    });
  };
}

module.exports = { errorHandler, notFoundHandler, STATUS_COPY };
