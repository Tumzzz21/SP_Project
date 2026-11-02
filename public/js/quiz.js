(function () {
  'use strict';
  var fieldset = document.querySelector('fieldset.quiz-card[data-attempt]');
  if (!fieldset) return;
  var attemptId = fieldset.getAttribute('data-attempt');
  var csrf = fieldset.getAttribute('data-csrf');
  var qid = fieldset.getAttribute('data-question');
  var radios = fieldset.querySelectorAll('input[type="radio"]');
  var continueBtn = document.querySelector('[data-continue]');
  var skipBtn = document.querySelector('[data-skip]');
  var prevBtn = document.querySelector('[data-prev]');
  var savedIndicator = document.getElementById('saved-indicator');

  function hasChoice() {
    return !!fieldset.querySelector('input[type="radio"]:checked');
  }

  function syncContinue() {
    if (continueBtn) {
      var isReview = (continueBtn.getAttribute('data-url') || '').indexOf('summary') !== -1;
      if (isReview) {
        continueBtn.removeAttribute('disabled');
        continueBtn.classList.remove('is-disabled');
      } else if (hasChoice()) {
        continueBtn.removeAttribute('disabled');
        continueBtn.classList.remove('is-disabled');
      } else {
        continueBtn.setAttribute('disabled', 'disabled');
        continueBtn.classList.add('is-disabled');
      }
    }
  }

  function save(val) {
    if (savedIndicator) savedIndicator.textContent = '';
    return fetch('/attempts/' + attemptId + '/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ questionId: Number(qid), selectedOptionId: val === null ? null : Number(val) }),
      credentials: 'same-origin',
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (j) { throw new Error((j && j.message) || 'save failed'); }).catch(function () { throw new Error('save failed'); });
      }
      if (savedIndicator) savedIndicator.textContent = 'Saved';
      return res.json();
    });
  }

  radios.forEach(function (r) {
    r.addEventListener('change', function () {
      syncContinue();
    });
  });

  if (continueBtn) {
    continueBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var isReview = (continueBtn.getAttribute('data-url') || '').indexOf('summary') !== -1;
      var checked = fieldset.querySelector('input[type="radio"]:checked');
      if (!isReview && !checked) {
        if (savedIndicator) savedIndicator.textContent = 'Please choose an answer';
        return;
      }
      var savePromise = checked ? save(checked.value) : Promise.resolve();
      savePromise.then(function () {
        if (isReview) {
          fetch('/attempts/' + attemptId + '/blanks', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
            var blanks = (j && j.blanks) || [];
            if (blanks.length) {
              if (savedIndicator) savedIndicator.textContent = 'Please answer question(s) ' + blanks.join(', ') + ' before submitting';
              var first = blanks[0];
              window.location.href = '/attempts/' + attemptId + '?q=' + first + '&blank=' + blanks.join(',');
            } else {
              window.location.href = continueBtn.getAttribute('data-url');
            }
          });
        } else {
          var url = continueBtn.getAttribute('data-url');
          if (url) window.location.href = url;
        }
      }).catch(function (err) {
        if (savedIndicator) savedIndicator.textContent = err && err.message ? err.message : 'Save failed';
      });
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var url = skipBtn.getAttribute('data-url');
      if (url) window.location.href = url;
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var url = prevBtn.getAttribute('data-url');
      if (url) window.location.href = url;
    });
  }

  syncContinue();
})();
