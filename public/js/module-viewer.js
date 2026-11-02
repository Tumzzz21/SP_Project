(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    const pages = Array.from(document.querySelectorAll('.mv-page'));
    const counter = document.getElementById('mv-counter');
    const prev = document.getElementById('mv-prev');
    const next = document.getElementById('mv-next');
    const zoomIn = document.getElementById('mv-zoom-in');
    const zoomOut = document.getElementById('mv-zoom-out');
    const fsBtn = document.getElementById('mv-fullscreen');
    const dl = document.getElementById('mv-download');
    const tocLinks = Array.from(document.querySelectorAll('.mv-toc-link'));
    const content = document.querySelector('.module-content');
    let idx = 0;
    let scale = 1;

    function applyScale() { pages.forEach(function (p) { p.style.transform = 'scale(' + scale + ')'; p.style.transformOrigin = 'top left'; }); }

    function show(i) {
      idx = Math.max(0, Math.min(pages.length - 1, i));
      pages.forEach(function (p, n) { p.hidden = n !== idx; });
      tocLinks.forEach(function (a, n) { a.classList.toggle('is-active', n === idx); });
      if (counter) counter.textContent = 'Page ' + (idx + 1) + ' of ' + pages.length;
      if (prev) prev.disabled = idx === 0;
      if (next) next.disabled = idx === pages.length - 1;
      if (dl) {
        const file = pages[idx] ? pages[idx].getAttribute('data-file') : null;
        if (file) { dl.href = file + '?download=1'; dl.style.display = ''; } else { dl.removeAttribute('href'); dl.style.display = 'none'; }
      }
    }

    if (prev) prev.addEventListener('click', function () { show(idx - 1); });
    if (next) next.addEventListener('click', function () { show(idx + 1); });
    tocLinks.forEach(function (a, n) { a.addEventListener('click', function (e) { e.preventDefault(); show(n); }); });
    if (zoomIn) zoomIn.addEventListener('click', function () { scale = Math.min(2, scale + 0.1); applyScale(); });
    if (zoomOut) zoomOut.addEventListener('click', function () { scale = Math.max(0.5, scale - 0.1); applyScale(); });
    if (fsBtn) fsBtn.addEventListener('click', function () {
      if (!document.fullscreenElement) { (content || document.documentElement).requestFullscreen && (content || document.documentElement).requestFullscreen(); }
      else { document.exitFullscreen && document.exitFullscreen(); }
    });

    show(0);
  });
})();
