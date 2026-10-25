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

  function formFields() {
    if (form.elements) return Array.prototype.slice.call(form.elements)
      .filter(function (field) { return field && (field.tagName === 'INPUT' || field.tagName === 'SELECT'); });
    return Array.prototype.slice.call(form.querySelectorAll('input, select'));
  }
  function namedField(name) {
    return form.elements && form.elements.namedItem ? form.elements.namedItem(name)
      : form.querySelector('input[name="' + name + '"]');
  }

  function refreshManualSubjects() {
    var required = 0, confirmed = 0;
    Array.prototype.slice.call(document.querySelectorAll('[data-manual-subject-issue]')).forEach(function (issue) {
      var srid = issue.getAttribute('data-manual-subject-issue');
      var checkbox = namedField('verify_manual_subject_' + srid);
      var status = document.getElementById('manual_issue_status_' + srid);
      var checked = !!checkbox && checkbox.checked;
      if (status) status.textContent = checked ? 'Manually confirmed' : 'MANUAL VERIFICATION REQUIRED';
      issue.classList.toggle('is-confirmed', checked);
      if (issue.hidden || !checkbox || checkbox.disabled) return;
      if (checked) confirmed++; else required++;
    });
    var count = document.getElementById('manualVerificationCount');
    if (count) count.textContent = '\u00b7 ' + (Number(count.getAttribute('data-manual-base')) + required) + ' manual checks required';
    var confirmations = document.getElementById('manualConfirmedCount');
    if (confirmations) {
      confirmations.textContent = '\u00b7 ' + confirmed + ' manually confirmed';
      confirmations.hidden = confirmed === 0;
    }
  }

  // Presentation only: UNVERIFIED and the acknowledgment remain authoritative
  // on the server. Manual confirmation must never be presented as a MATCH.
  var oldResultCheckbox = namedField('verify_old_status');
  var oldResultStatus = document.getElementById('oldExternalResultVerificationStatus');
  if (oldResultCheckbox && oldResultStatus) {
    function refreshOldResultStatus() {
      oldResultStatus.textContent = oldResultCheckbox.checked
        ? 'Manually confirmed' : 'Manual verification required';
      oldResultStatus.classList.toggle('is-required', !oldResultCheckbox.checked);
      oldResultStatus.classList.toggle('is-confirmed', oldResultCheckbox.checked);
    }
    oldResultCheckbox.addEventListener('change', refreshOldResultStatus);
    refreshOldResultStatus();
  }
  Array.prototype.slice.call(document.querySelectorAll('[data-manual-status-for]')).forEach(function (status) {
    var checkbox = namedField('verify_' + status.getAttribute('data-manual-status-for'));
    if (!checkbox) return;
    function refresh() {
      status.textContent = checkbox.checked ? 'Manually confirmed' : 'Manual verification required';
      status.classList.toggle('is-required', !checkbox.checked);
      status.classList.toggle('is-confirmed', checkbox.checked);
      refreshManualSubjects();
    }
    checkbox.addEventListener('change', refresh);
    refresh();
  });

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
      el.required = accepting;
      if (!accepting) {
        el.setCustomValidity('');
        el.removeAttribute('aria-invalid');
        el.classList.remove('is-invalid');
        el.setAttribute('tabindex', '-1');
      } else {
        el.removeAttribute('tabindex');
        // When Accept is selected, leave both Internal and Rev. Ext fields
        // empty so the admin can enter the revised marks manually. The fields
        // are enabled (no longer disabled) so the admin can type in them.
      }
    });
    ['pick_', 'ack_'].forEach(function (prefix) {
      var field = document.getElementById(prefix + srid);
      if (field) {
        field.required = accepting;
        if (!accepting) {
          field.classList.remove('is-invalid');
          field.removeAttribute('aria-invalid');
        }
      }
    });
    var manualIssue = document.getElementById('manual_issue_' + srid);
    var manualCheckbox = document.getElementById('verify_manual_subject_' + srid);
    if (manualIssue) manualIssue.hidden = !accepting;
    if (manualCheckbox) {
      manualCheckbox.disabled = !accepting;
      manualCheckbox.required = accepting;
      if (!accepting) {
        manualCheckbox.classList.remove('is-invalid');
        manualCheckbox.removeAttribute('aria-invalid');
      }
    }
    refreshManualSubjects();
    refreshRow(srid);
  }

  function validateRow(srid) {
    var els = rowInputs(srid);
    [els.intEl, els.extEl].forEach(function (field) {
      if (!field || field.disabled) return;
      var value = toInt(field.value);
      var error = value === null || value < 0 || value > Number(field.max)
        ? 'Enter a whole number from 0 to ' + field.max + '.' : '';
      field.setCustomValidity(error);
      var feedback = document.getElementById(field.id + '_feedback');
      if (feedback) feedback.textContent = error || 'Enter a whole number from 0 to ' + field.max + '.';
    });
    if (!els.intEl || !els.extEl || els.intEl.disabled || els.extEl.disabled) return;
    var row = els.extEl.closest('tr');
    if (row && els.intEl.validity.valid && els.extEl.validity.valid
      && Number(els.intEl.value) + Number(els.extEl.value) > Number(row.dataset.maxMarks)) {
      var error = 'Internal plus revised external marks must not exceed ' + row.dataset.maxMarks + '.';
      els.extEl.setCustomValidity(error);
      var feedback = document.getElementById(els.extEl.id + '_feedback');
      if (feedback) feedback.textContent = error;
    }
  }

  function markValidity(field) {
    var invalid = !field.disabled && !field.validity.valid;
    field.classList.toggle('is-invalid', invalid);
    if (invalid) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }

  // Wire every decision radio + mark input present in EDIT mode.
  Array.prototype.slice.call(document.querySelectorAll('input.rev-decision'))
    .forEach(function (radio) {
      radio.addEventListener('change', function () {
        syncDisabled(radio.getAttribute('data-srid'));
        validateRow(radio.getAttribute('data-srid'));
        if (form.classList.contains('was-validated')) {
          formFields().forEach(markValidity);
        }
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


  // Bootstrap feedback is a convenience; the server repeats every integrity check.
  formFields().forEach(function (field) {
    field.addEventListener(field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input', function () {
      if (field.classList.contains('rev-int') || field.classList.contains('rev-ext')) {
        validateRow(field.getAttribute('data-srid'));
      }
      if (form.classList.contains('was-validated')) {
        formFields().forEach(markValidity);
      }
    });
  });
  form.addEventListener('submit', function (ev) {
    Array.prototype.slice.call(document.querySelectorAll('#reviewTable tbody tr'))
      .forEach(function (tr) {
        var radio = tr.querySelector('input.rev-decision:checked');
        if (!radio || radio.value !== 'accept') return;
        validateRow(radio.getAttribute('data-srid'));
      });
    form.classList.add('was-validated');
    if (!form.checkValidity()) {
      ev.preventDefault();
      ev.stopPropagation();
      formFields().forEach(markValidity);
      var firstInvalid = formFields().find(function (field) { return !field.disabled && !field.validity.valid; });
      if (firstInvalid) {
        var details = firstInvalid.closest('details');
        if (details) details.open = true;
        firstInvalid.focus();
      }
    }
  });
})();
