'use strict';

/**
 * Admin quiz question editor.
 *
 * Progressive enhancement for the draft question form: add/remove questions,
 * add/remove options, reorder questions. After every change the fields are
 * renumbered so the server receives contiguous q_<i>_* indexes, matching
 * parseQuestionForm() in src/validation.js. Without JS the page still renders
 * its server-side blocks and saves normally.
 */
(function () {
  var form = document.querySelector('.q-editor');
  if (!form) return;

  var template = document.getElementById('q-template');
  var addQuestionBtn = form.querySelector('[data-q-add]');
  var emptyHint = form.querySelector('[data-q-empty]');

  function blocks() {
    return Array.prototype.slice.call(form.querySelectorAll('[data-q-block]'));
  }

  function options(block) {
    return Array.prototype.slice.call(block.querySelectorAll('[data-q-option]'));
  }

  /** Give an option row a remove button (idempotent). */
  function ensureRemoveButton(row) {
    if (row.querySelector('[data-q-remove-option]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost btn-sm';
    button.setAttribute('data-q-remove-option', '');
    button.textContent = 'Remove';
    row.appendChild(button);
  }

  /** Re-number question, option, and radio names to match DOM order. */
  function renumber() {
    var list = blocks();
    list.forEach(function (block, i) {
      var number = block.querySelector('[data-q-number]');
      if (number) number.textContent = String(i + 1);

      var prompt = block.querySelector('[data-q-field="prompt"]');
      if (prompt) prompt.name = 'q_' + i + '_prompt';
      var explanation = block.querySelector('[data-q-field="explanation"]');
      if (explanation) explanation.name = 'q_' + i + '_explanation';

      options(block).forEach(function (row, j) {
        ensureRemoveButton(row);
        var correct = row.querySelector('[data-q-correct]');
        if (correct) {
          correct.name = 'q_' + i + '_correct';
          correct.value = String(j);
          correct.id = 'q_' + i + '_correct_' + j;
          correct.setAttribute('aria-label', 'Mark option ' + (j + 1) + ' correct');
        }
        var label = row.querySelector('[data-q-option-label]');
        if (label) {
          label.name = 'q_' + i + '_opt_' + j;
          label.id = 'q_' + i + '_opt_' + j;
          label.placeholder = 'Option ' + (j + 1);
        }
        // Keep at least two options: hide removal on the first two rows.
        var remove = row.querySelector('[data-q-remove-option]');
        if (remove) remove.hidden = j < 2;
      });
    });

    if (emptyHint) emptyHint.hidden = list.length > 0;
  }

  function addOption(block) {
    var list = block.querySelector('[data-q-options]');
    if (!list) return;
    var rows = options(block);
    if (rows.length >= 6) return; // MAX_OPTIONS_PER_QUESTION on the server
    var source = rows[rows.length - 1];
    var row = source.cloneNode(true);
    var input = row.querySelector('[data-q-option-label]');
    if (input) input.value = '';
    list.appendChild(row);
    renumber();
    var fresh = row.querySelector('[data-q-option-label]');
    if (fresh) fresh.focus();
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

    if (target.closest('[data-q-add-option]')) {
      addOption(block);
      return;
    }
    if (target.closest('[data-q-remove-option]')) {
      var row = target.closest('[data-q-option]');
      if (row && options(block).length > 2) {
        row.parentNode.removeChild(row);
        renumber();
      }
      return;
    }
    if (target.closest('[data-q-remove]')) {
      if (blocks().length <= 1) {
        // Never leave the form empty — clearing the fields is enough: an
        // untouched block is skipped by the server parser.
        var inputs = block.querySelectorAll('input, textarea');
        Array.prototype.forEach.call(inputs, function (input) {
          if (input.type === 'radio') input.checked = false;
          else input.value = '';
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
    }
  });

  if (addQuestionBtn) {
    addQuestionBtn.addEventListener('click', addQuestion);
  }

  renumber();
})();
