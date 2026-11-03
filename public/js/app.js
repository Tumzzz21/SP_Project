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
  // ---- confirmation for destructive forms --------------------------------
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var message = form.getAttribute('data-confirm');
      if (message && !window.confirm(message)) {
        event.preventDefault();
      }
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

// Quiz card overflow menus (admin only). Each menu is independent, and all of
// the state lives in aria-expanded so keyboard and pointer users share it.
(function () {
  'use strict';

  var menus = Array.prototype.slice.call(document.querySelectorAll('[data-quiz-menu]'));
  if (menus.length === 0) return;

  function menuParts(menu) {
    return {
      toggle: menu.querySelector('[data-quiz-menu-toggle]'),
      panel: menu.querySelector('.quiz-menu-panel'),
    };
  }

  function closeMenu(menu, refocus) {
    var parts = menuParts(menu);
    if (!parts.toggle || !parts.panel) return;
    parts.panel.hidden = true;
    parts.toggle.setAttribute('aria-expanded', 'false');
    if (refocus) parts.toggle.focus();
  }

  function openMenu(menu, focusFirst) {
    var parts = menuParts(menu);
    if (!parts.toggle || !parts.panel) return;
    menus.forEach(function (other) {
      if (other !== menu) closeMenu(other, false);
    });
    parts.panel.hidden = false;
    parts.toggle.setAttribute('aria-expanded', 'true');
    if (focusFirst) {
      var first = parts.panel.querySelector('.quiz-menu-item');
      if (first) first.focus();
    }
  }

  function menuItems(menu) {
    return Array.prototype.slice.call(menu.querySelectorAll('.quiz-menu-item'));
  }

  menus.forEach(function (menu) {
    var parts = menuParts(menu);
    if (!parts.toggle || !parts.panel) return;

    parts.toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      if (parts.panel.hidden) openMenu(menu, false);
      else closeMenu(menu, false);
    });

    parts.toggle.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openMenu(menu, true);
        }
      } else if (event.key === 'Escape' && !parts.panel.hidden) {
        event.preventDefault();
        closeMenu(menu, true);
      }
    });

    parts.panel.addEventListener('keydown', function (event) {
      var items = menuItems(menu);
      var index = items.indexOf(document.activeElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(menu, true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (items.length === 0) return;
        var next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        if (next >= items.length) next = 0;
        if (next < 0) next = items.length - 1;
        items[next].focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (items.length === 0) return;
        items[event.key === 'Home' ? 0 : items.length - 1].focus();
      }
    });
  });

  document.addEventListener('click', function (event) {
    menus.forEach(function (menu) {
      if (!menu.contains(event.target)) closeMenu(menu, false);
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    menus.forEach(function (menu) {
      var parts = menuParts(menu);
      if (parts.panel && !parts.panel.hidden && !menu.contains(document.activeElement)) {
        closeMenu(menu, false);
      }
    });
  });
})();

// Quiz catalogue search and filter chips. Progressive enhancement: without
// JavaScript every card stays visible and the server-rendered links work.
(function () {
  'use strict';

  var root = document.querySelector('[data-quiz-filters]');
  if (!root) return;

  var search = root.querySelector('[data-quiz-search]');
  var chips = Array.prototype.slice.call(root.querySelectorAll('[data-quiz-filter]'));
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-quiz-card]'));
  var empty = document.querySelector('[data-quiz-empty]');
  var archive = document.querySelector('[data-quiz-archive]');
  var grid = document.querySelector('[data-quiz-grid]');
  var active = root.getAttribute('data-active-filter') || 'all';

  function applyFilters() {
    var term = search ? search.value.trim().toLowerCase() : '';
    var visible = 0;

    cards.forEach(function (card) {
      var haystack = (card.getAttribute('data-quiz-search') || '').toLowerCase();
      var status = card.getAttribute('data-quiz-status') || '';
      var attempt = card.getAttribute('data-quiz-attempt') || '';
      var matchesSearch = term === '' || haystack.indexOf(term) !== -1;
      var matchesFilter = active === 'all' || status === active || attempt === active;
      var show = matchesSearch && matchesFilter;
      card.hidden = !show;
      if (show) visible += 1;
    });

    if (archive) {
      var archivedVisible = Array.prototype.some.call(
        archive.querySelectorAll('[data-quiz-card]'),
        function (card) { return !card.hidden; }
      );

      if (active === 'archived') {
        // The Archived chip is a dedicated view: only retired versions, opened.
        archive.hidden = false;
        archive.open = true;
      } else if (active === 'all') {
        // "All" keeps every live quiz plus the collapsed archive at the bottom.
        archive.hidden = term !== '' && archivedVisible === 0;
      } else {
        archive.hidden = true;
        archive.open = false;
      }

      if (grid) grid.hidden = active === 'archived';
    }

    if (empty) empty.hidden = visible !== 0;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      active = chip.getAttribute('data-quiz-filter') || 'all';
      chips.forEach(function (other) {
        var isActive = other === chip;
        other.classList.toggle('is-active', isActive);
        other.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      applyFilters();
    });
  });

  if (search) {
    search.addEventListener('input', applyFilters);
    search.addEventListener('search', applyFilters);
  }

  applyFilters();
})();
