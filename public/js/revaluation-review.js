/**
 * PROMPT 5 — review page behaviour.
 *  - live derived-total preview (int+ext only; server recomputes anyway)
 *  - accept/reject radios toggle the number inputs for that row
 * Everything here is cosmetic: the server is authoritative.
 */
(function () {
  'use strict';

  var form = document.getElementById('reviewForm');
  if (!form) return;

  function rowInputs(srid) {
    return {
      intEl: document.getElementById('int_' + srid),
      extEl: document.getElementById('ext_' + srid),
      totEl: document.getElementById('tot_' + srid)
    };
  }

  function toInt(v) {
    var s = String(v == null ? '' : v).trim();
    return (/^-?[0-9]+$/.test(s)) ? parseInt(s, 10) : null;
  }

  function refreshRow(srid) {
    var els = rowInputs(srid);
    var tot = null;
    if (els.intEl && els.extEl) {
      var i = toInt(els.intEl.value);
      var e = toInt(els.extEl.value);
      tot = (i !== null && e !== null) ? (i + e) : null;
    }
    if (els.totEl) {
      els.totEl.textContent = (tot !== null) ? tot : '—';
    }
  }

  function syncDisabled(srid) {
    var els = rowInputs(srid);
    var checked = form.querySelector(
      'input.rev-decision[name="decision_' + srid + '"]:checked');
    var accepting = !!checked && checked.value === 'accept';
    [els.intEl, els.extEl].forEach(function (el) {
      if (!el) return;
      el.disabled = !accepting;
      if (!accepting) {
        el.classList.remove('is-invalid');
        el.setAttribute('tabindex', '-1');
      } else {
        el.removeAttribute('tabindex');
      }
    });
    refreshRow(srid);
  }

  // Wire every decision radio + mark input present in EDIT mode.
  Array.prototype.slice.call(document.querySelectorAll('input.rev-decision'))
    .forEach(function (radio) {
      radio.addEventListener('change', function () {
        syncDisabled(radio.getAttribute('data-srid'));
      });
      if (radio.checked) syncDisabled(radio.getAttribute('data-srid'));
    });

  Array.prototype.slice.call(form.querySelectorAll('.rev-int, .rev-ext'))
    .forEach(function (input) {
      input.addEventListener('input', refreshRow.bind(null, input.getAttribute('data-srid')));
    });

  // Initial paint + safety: disable inputs whose default is reject.
  Array.prototype.slice.call(document.querySelectorAll('#reviewTable tbody tr'))
    .forEach(function (tr) {
      var any = tr.querySelector('input.rev-decision');
      if (any) syncDisabled(any.getAttribute('data-srid'));
    });

  // PROMPT 15: wire 'Attach' buttons for unmatched OCR rows.
  Array.prototype.slice.call(document.querySelectorAll('.attach-ocr-btn'))
    .forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = btn.getAttribute('data-unmatched-index');
        var container = document.querySelector('[data-unmatched-index="' + idx + '"]');
        if (!container) return;

        var select = container.querySelector('.attach-target-select');
        var internalInput = container.querySelector('.attach-internal-input');
        var externalInput = container.querySelector('.attach-external-input');
        var targetHidden = container.querySelector('.attach-target-hidden');
        var internalHidden = container.querySelector('.attach-internal-hidden');
        var externalHidden = container.querySelector('.attach-external-hidden');
        var msgEl = container.querySelector('.attach-result-msg');

        var srid = select ? select.value : '';
        var intVal = internalInput ? (internalInput.value.trim() || '') : '';
        var extVal = externalInput ? (externalInput.value.trim() || '') : '';

        if (!srid) {
          msgEl.textContent = 'Please select a SubjectResult first.';
          msgEl.className = 'attach-result-msg mt-1 small text-danger';
          return;
        }

        // Populate hidden fields so the server receives them.
        if (targetHidden) targetHidden.value = srid;
        if (internalHidden) internalHidden.value = intVal;
        if (externalHidden) externalHidden.value = extVal;

        var selectedText = select.options[select.selectedIndex].text;
        msgEl.textContent = 'Attached to ' + selectedText + ' — marks int=' +
          (intVal || '—') + ' ext=' + (extVal || '—') +
          '. Save the form to persist.';
        msgEl.className = 'attach-result-msg mt-1 small text-success';
      });
    });

  // Client-side nicety only: block obvious empty-int/ext submits early.
  form.addEventListener('submit', function (ev) {
    var ok = true;
    Array.prototype.slice.call(document.querySelectorAll('#reviewTable tbody tr'))
      .forEach(function (tr) {
        var radio = tr.querySelector('input.rev-decision:checked');
        if (!radio || radio.value !== 'accept') return;
        var srid = radio.getAttribute('data-srid');
        var els = rowInputs(srid);
        if (!els.intEl || !els.extEl) return;
        if (toInt(els.intEl.value) === null || toInt(els.extEl.value) === null) {
          ok = false;
          els.intEl.classList.add('is-invalid');
          els.extEl.classList.add('is-invalid');
        }
      });
    if (!ok) ev.preventDefault();
  });
})();
