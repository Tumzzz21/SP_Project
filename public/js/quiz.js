/* CyberSafe quiz helpers - progressive enhancement only.
   The quiz works without JavaScript; this file only keeps the answered
   counter and progress bar in sync with the radio inputs. */
(function () {
  'use strict';

  var form = document.querySelector('[data-quiz-form]');
  if (!form) return;

  var counter = form.querySelector('[data-answer-counter]');
  var progress = form.querySelector('[data-answer-progress]');
  var questions = form.querySelectorAll('fieldset.question-card');

  function update() {
    var answered = 0;
    questions.forEach(function (question) {
      if (question.querySelector('input[type="radio"]:checked')) answered += 1;
    });
    if (counter) {
      counter.textContent = answered + ' of ' + questions.length + ' answered';
    }
    if (progress) {
      progress.value = answered;
      progress.max = questions.length;
    }
  }

  form.addEventListener('change', function (event) {
    if (event.target && event.target.type === 'radio') update();
  });

  update();
})();
