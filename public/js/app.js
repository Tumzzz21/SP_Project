/* CyberSafe - progressive enhancement only.
   Every page works without JavaScript; this file only improves interaction. */
(function () {
  'use strict';

  // ---- mobile navigation -------------------------------------------------
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.getElementById('primary-nav');

  function closeNav() {
    if (!nav || !toggle) return;
    nav.removeAttribute('data-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      if (open) {
        closeNav();
      } else {
        nav.setAttribute('data-open', 'true');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeNav();
    });

    document.addEventListener('click', function (event) {
      if (nav.getAttribute('data-open') !== 'true') return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      closeNav();
    });
  }

  // ---- account dropdown (avatar menu) -------------------------------------
  var userMenu = document.querySelector('[data-user-menu]');

  if (userMenu) {
    var userToggle = document.getElementById('nav-avatar-btn');
    var userPanel = userMenu.querySelector('.profile-menu');

    function closeUserMenu() {
      if (!userPanel || !userToggle) return;
      userPanel.classList.remove('is-open');
      userToggle.setAttribute('aria-expanded', 'false');
    }

    function openUserMenu() {
      if (!userPanel || !userToggle) return;
      userPanel.classList.add('is-open');
      userToggle.setAttribute('aria-expanded', 'true');
    }

    if (userToggle && userPanel) {
      userToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        if (userPanel.classList.contains('is-open')) {
          closeUserMenu();
        } else {
          openUserMenu();
        }
      });

      // Clicking anywhere outside the menu closes it.
      document.addEventListener('click', function (event) {
        if (userMenu.contains(event.target)) return;
        closeUserMenu();
      });

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!userPanel.classList.contains('is-open')) return;
        closeUserMenu();
        userToggle.focus();
      });
    }
  }

  // ---- pending state for submitting forms --------------------------------
  document.querySelectorAll('form[data-pending-form]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var button = form.querySelector('button[type="submit"]');
      if (!button || button.disabled) return;
      button.dataset.pending = 'true';
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.textContent = 'Working\u2026';
      // If the browser restores the page from the back/forward cache the
      // button must not stay stuck in its pending state.
      window.addEventListener('pageshow', function () {
        button.disabled = false;
        button.dataset.pending = 'false';
        if (button.dataset.label) button.textContent = button.dataset.label;
      });
    });
  });
})();

// Module row expand/collapse
document.querySelectorAll('[data-module-toggle]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const row = btn.closest('.module-row');
    const items = row && row.querySelector('.module-row-items');
    if (!items) return;
    const open = items.hasAttribute('hidden');
    if (open) items.removeAttribute('hidden'); else items.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
});
