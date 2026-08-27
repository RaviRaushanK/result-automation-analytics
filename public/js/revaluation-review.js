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
