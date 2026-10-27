'use strict';

/**
 * Domain error type. `publicMessage` is safe to show to the visitor;
 * `details` stays server side (never rendered to the browser).
 */
class AppError extends Error {
  /**
   * @param {number} statusCode HTTP status
   * @param {string} publicMessage short, actionable, human readable
   * @param {{code?: string, details?: unknown, expose?: boolean}} [options]
   */
  constructor(statusCode, publicMessage, options = {}) {
    super(publicMessage);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
    this.code = options.code || 'error';
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

const notFound = (message = 'We could not find that page.') =>
  new AppError(404, message, { code: 'not_found' });

const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, message, { code: 'unauthorized' });

const forbidden = (message = 'You do not have access to that page.') =>
  new AppError(403, message, { code: 'forbidden' });

module.exports = { AppError, notFound, unauthorized, forbidden };
