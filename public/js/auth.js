'use strict';

/**
 * Auth-page enhancements: the show/hide password eye toggle.
 * Kept in its own file because the CSP forbids inline scripts; it degrades
 * gracefully — without JavaScript the buttons simply do nothing and the
 * inputs stay password-masked.
 */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-password]');
  if (!button) return;

  const input = document.getElementById(button.getAttribute('data-toggle-password'));
  if (!input) return;

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.setAttribute('aria-pressed', String(!showing));
  button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});
