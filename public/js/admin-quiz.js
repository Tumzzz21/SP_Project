'use strict';

(function () {
  var form = document.querySelector('.q-editor');
  if (!form) return;

  var template = document.getElementById('q-template');
  var addQuestionBtn = form.querySelector('[data-q-add]');
  var emptyHint = form.querySelector('[data-q-empty]');

  function blocks() {
    return Array.prototype.slice.call(form.querySelectorAll('[data-q-block]'));
  }

  function renumber() {
    var list = blocks();
    list.forEach(function (block, i) {
      var number = block.querySelector('[data-q-number]');
      if (number) number.textContent = String(i + 1);

      var prompt = block.querySelector('[data-q-field="prompt"]');
      if (prompt) prompt.name = 'q_' + i + '_prompt';

      for (var j = 0; j < 4; j++) {
        var opt = block.querySelector('[data-q-opt="' + j + '"]');
        if (opt) {
          opt.name = 'q_' + i + '_opt_' + j;
          opt.id = 'q_' + i + '_opt_' + j;
        }
      }

      var correct = block.querySelector('[data-q-correct]');
      if (correct) correct.name = 'q_' + i + '_correct';

      var explanation = block.querySelector('[data-q-field="explanation"]');
      if (explanation) explanation.name = 'q_' + i + '_explanation';
    });

    if (emptyHint) emptyHint.hidden = list.length > 0;
  }

  function addQuestion() {
    if (!template) return;
    var addBar = addQuestionBtn ? addQuestionBtn.parentNode : null;
    var node = template.content ? template.content.cloneNode(true) : template.cloneNode(true);
    var block = node.querySelector ? node.querySelector('[data-q-block]') : null;
    if (addBar && block) {
      form.insertBefore(node, addBar);
    } else {
      form.appendChild(node);
    }
    renumber();
    var freshPrompt = form.querySelectorAll('[data-q-block]');
    var last = freshPrompt[freshPrompt.length - 1];
    var prompt = last && last.querySelector('[data-q-field="prompt"]');
    if (prompt) prompt.focus();
  }

  form.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var block = target.closest('[data-q-block]');
    if (!block) return;

    if (target.closest('[data-q-remove]')) {
      if (blocks().length <= 1) {
        var inputs = block.querySelectorAll('input, textarea, select');
        Array.prototype.forEach.call(inputs, function (input) {
          if (input.type !== 'radio' && input.type !== 'checkbox') input.value = '';
        });
        return;
      }
      block.parentNode.removeChild(block);
      renumber();
      return;
    }
    if (target.closest('[data-q-move-up]')) {
      var previous = block.previousElementSibling;
      while (previous && !previous.hasAttribute('data-q-block')) {
        previous = previous.previousElementSibling;
      }
      if (previous && previous.hasAttribute('data-q-block')) {
        block.parentNode.insertBefore(block, previous);
        renumber();
      }
      return;
    }
    if (target.closest('[data-q-move-down]')) {
      var next = block.nextElementSibling;
      while (next && !next.hasAttribute('data-q-block')) {
        next = next.nextElementSibling;
      }
      if (next && next.hasAttribute('data-q-block')) {
        block.parentNode.insertBefore(next, block);
        renumber();
      }
      return;
    }
  });

  if (addQuestionBtn) {
    addQuestionBtn.addEventListener('click', addQuestion);
  }

  renumber();
})();
