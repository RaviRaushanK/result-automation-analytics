/**
 * SRAAS — Upload Results (Page 2: Review & Edit)
 * Live recalculation of Total and PASS/FAIL as the admin edits marks.
 * Extraction-result validation: warns on missing required fields and
 * blocks the submit while any required field is empty. Server-side
 * validation still happens on submit (authoritative).
 */
document.addEventListener('DOMContentLoaded', function () {
    var rows = document.querySelectorAll('#reviewForm tbody tr[data-max-marks]');
    var form = document.getElementById('reviewForm');
    var validationAttempted = false;

    /**
     * collectMissingFields
     * Inspects the current values of required fields in the review form and
     * returns an array of {field, message, el} describing each missing/invalid
     * required value. Used by:
     *   1) initial extraction-warning display,
     *   2) live revalidation while the admin edits, and
     *   3) the submit-time guard.
     * Notes:
     *   - "0" is a valid marks value; do not flag it as missing.
     *   - Whitespace-only values are treated as missing.
     */
    function collectMissingFields() {
        var missing = [];

        var usnEl = document.getElementById('usnInput');
        if (usnEl) {
            var usn = (usnEl.value || '').trim();
            if (usn === '' || usn === 'undefined' || usn === 'null') {
                missing.push({ field: 'student.usn', message: 'USN is required.', el: usnEl });
            }
        }

        var nameEl = document.getElementById('studentNameInput');
        if (nameEl) {
            var name = (nameEl.value || '').trim();
            if (name === '' || name === 'undefined' || name === 'null') {
                missing.push({ field: 'student.name', message: 'Student name is required.', el: nameEl });
            }
        }

        var typeField = form && form.querySelector ? form.querySelector('[name="exam_type"]') : null;
        var retake = typeField && typeField.value !== 'REGULAR';
        var attemptEl = document.getElementById('reviewAttemptNo');
        if (attemptEl) {
            var attempt = String(attemptEl.value).trim();
            if (!/^\d+$/.test(attempt) || !Number.isSafeInteger(Number(attempt))
                || (retake ? Number(attempt) < 2 : Number(attempt) !== 1)) {
                missing.push({ field: 'attempt_no', message: retake ? 'Enter a whole-number attempt of 2 or later.' : 'Regular results must use Attempt 1.', el: attemptEl });
            }
        }
        var attemptedRows = 0;
        rows.forEach(function (row) {
            var internalInput = row.querySelector('.internal-input');
            var externalInput = row.querySelector('.external-input');
            if (retake && internalInput.value === '' && externalInput.value === '') return;
            attemptedRows++;
            var subjectId = row.dataset.subjectId;

            [internalInput, externalInput].forEach(function (input) {
                if (!input) return;
                var raw = input.value;
                if (raw === null || raw === undefined) {
                    missing.push({
                        field: 'subjects[' + subjectId + '].marks',
                        message: 'Marks are required.',
                        el: input
                    });
                    return;
                }
                if (typeof raw === 'string' && raw.trim() === '') {
                    missing.push({
                        field: 'subjects[' + subjectId + '].marks',
                        message: 'Marks are required.',
                        el: input
                    });
                } else if (!/^\d+$/.test(String(raw).trim()) || !Number.isSafeInteger(Number(raw))
                    || Number(raw) < 0 || Number(raw) > Number(input.max)) {
                    missing.push({ field: input.name, message: 'Enter a whole number from 0 to ' + input.max + '.', el: input });
                }
            });
            if ([internalInput, externalInput].every(function (input) { return /^\d+$/.test(input.value); })
                && Number(internalInput.value) + Number(externalInput.value) > Number(row.dataset.maxMarks)) {
                missing.push({ field: 'subjects[' + subjectId + '].total', message: 'Total marks must not exceed ' + row.dataset.maxMarks + '.', el: externalInput, totalRow: row });
            }
        });
        if (retake && !attemptedRows && rows.length) missing.push({ field: 'subjects', message: 'Enter marks for at least one attempted subject.', el: rows[0].querySelector('.internal-input') });
        if (validationAttempted && form && form.querySelectorAll) {
            form.querySelectorAll('input[type="checkbox"][required]').forEach(function (input) {
                if (!input.checked) missing.push({ field: input.name, message: 'Confirm this document detail against the original marks card before validating.', el: input });
            });
        }

        return missing;
    }

    /**
     * updateExtractionWarning
     * Shows/hides the form-level extraction warning and applies
     * is-invalid / field-level error messages around affected inputs.
     */
    function updateExtractionWarning() {
        var alertEl = document.getElementById('extractionAlert');
        var msgEl = document.getElementById('extractionAlertMessage');

        // Remove any dynamically-added field error messages (those without the
        // server-rendered marker). Server-rendered messages (added by EJS for
        // a re-rendered validation error page) are preserved.
        document.querySelectorAll('#reviewForm .field-error-message').forEach(function (node) {
            if (node.dataset.serverRendered === 'true') return;
            if (node.parentNode) node.parentNode.removeChild(node);
        });

        // Clear is-invalid class only on inputs that were not server-flagged.
        document.querySelectorAll('#reviewForm .is-invalid').forEach(function (el) {
            if (!el.dataset.serverInvalid) {
                el.classList.remove('is-invalid');
                el.removeAttribute('aria-invalid');
            }
        });

        rows.forEach(function (row) {
            var feedback = document.getElementById('total_' + row.dataset.subjectId + '_feedback');
            if (feedback) { feedback.hidden = true; feedback.textContent = ''; feedback.classList.remove('d-block'); }
            var cell = row.querySelector('.total-cell');
            if (cell) cell.classList.remove('text-danger');
        });
        var missing = collectMissingFields();

        missing.forEach(function (m) {
            if (!m.totalRow && m.el && m.el.classList) {
                m.el.classList.add('is-invalid');
                m.el.setAttribute('aria-invalid', 'true');
            }
        });

        // Append a single field-level warning message under each affected input
        // only if the server didn't already render one.
        var seen = {};
        missing.forEach(function (m) {
            if (!m.el) return;
            if (m.totalRow) {
                var totalFeedback = document.getElementById('total_' + m.totalRow.dataset.subjectId + '_feedback');
                if (totalFeedback) { totalFeedback.textContent = m.message; totalFeedback.hidden = false; totalFeedback.classList.add('d-block'); }
                m.totalRow.querySelector('.total-cell').classList.add('text-danger');
                return;
            }
            if (seen[m.el.id]) return;
            seen[m.el.id] = true;

            var feedback = m.el.parentNode.querySelector('.invalid-feedback');
            if (feedback) { feedback.textContent = m.message; return; }

            var existing = m.el.parentNode.querySelector('.field-error-message');
            if (existing) return; // already server-rendered, leave it

            var msg = document.createElement('div');
            msg.className = 'field-error-message invalid-feedback d-block';
            msg.id = m.el.id + '_feedback';
            msg.textContent = m.message;
            m.el.parentNode.appendChild(msg);
            var describedBy = m.el.getAttribute('aria-describedby') || '';
            if (describedBy.split(' ').indexOf(msg.id) < 0) m.el.setAttribute('aria-describedby', (describedBy + ' ' + msg.id).trim());
        });

        if (missing.length === 0) {
            if (alertEl) alertEl.style.display = 'none';
            return;
        }

        var count = missing.length;
        var noun = (count === 1) ? 'field needs' : 'fields need';
        var text = 'Please review and correct the highlighted fields before validating the result. (' + count + ' ' + noun + ' attention.)';
        if (msgEl) msgEl.textContent = text;
        if (alertEl) alertEl.style.display = '';
    }

    rows.forEach(function (row) {
        var internalInput = row.querySelector('.internal-input');
        var externalInput = row.querySelector('.external-input');
        var totalCell = row.querySelector('.total-value');
        var statusCell = row.querySelector('.status-cell');

        if (!internalInput || !externalInput || !totalCell || !statusCell) return;

        var maxMarks = parseInt(row.dataset.maxMarks, 10) || 100;

        function update() {
            var internal = parseInt(internalInput.value, 10) || 0;
            var external = parseInt(externalInput.value, 10) || 0;
            var total = internal + external;

            if (internalInput.value === '' && externalInput.value === '') {
                totalCell.textContent = '—';
                statusCell.innerHTML = '<span class="badge bg-secondary">N/A</span>';
                return;
            }
            totalCell.textContent = total;

            var pass = typeof McaPassRules !== 'undefined' && McaPassRules.evaluate(Number(internalInput.value), Number(externalInput.value), {
                subject_type: row.dataset.subjectType, max_internal: Number(row.dataset.maxInternal),
                max_external: Number(row.dataset.maxExternal), max_marks: maxMarks
            }).status === 'pass';
            if (internalInput.value !== '' && externalInput.value !== '' && pass && row.dataset.documentStatus !== 'fail') {
                statusCell.innerHTML = '<span class="badge bg-success">PASS</span>';
            } else {
                statusCell.innerHTML = '<span class="badge bg-danger">FAIL</span>';
            }
        }

        internalInput.addEventListener('input', function () {
            update();
            updateExtractionWarning();
        });
        externalInput.addEventListener('input', function () {
            update();
            updateExtractionWarning();
        });

        update();
    });

    // Live revalidation of student name + USN fields.
    var usnEl = document.getElementById('usnInput');
    var nameEl = document.getElementById('studentNameInput');
    var blockedUsn = usnEl ? usnEl.value.trim().toUpperCase() : '';
    if (usnEl) {
        usnEl.addEventListener('input', function () {
            this.classList.remove('is-invalid');
            if (form && form.dataset.registrationBlocked === 'true' && this.value.trim().toUpperCase() !== blockedUsn) {
                form.dataset.registrationBlocked = 'false';
                var validateButton = document.getElementById('validateButton');
                if (validateButton) {
                    validateButton.disabled = false;
                    validateButton.removeAttribute('aria-describedby');
                }
                var hint = document.getElementById('studentRegistrationHint');
                if (hint) hint.hidden = true;
            }
            updateExtractionWarning();
        });
    }
    if (nameEl) {
        nameEl.addEventListener('input', function () {
            this.classList.remove('is-invalid');
            updateExtractionWarning();
        });
    }

    // Initial render: show extraction warning if fields are missing on page load.
    updateExtractionWarning();
    if (form && form.querySelectorAll) {
        form.querySelectorAll('input[type="checkbox"][required], #reviewAttemptNo').forEach(function (input) {
            input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', updateExtractionWarning);
        });
    }

    // Submit-time guard: same validation, never trust the browser submit.
    if (form) {
        form.addEventListener('submit', function (e) {
            if (form.dataset.registrationBlocked === 'true') {
                e.preventDefault();
                var registrationAlert = document.getElementById('resultValidationAlert');
                if (registrationAlert) registrationAlert.scrollIntoView({ block: 'center' });
                return false;
            }
            validationAttempted = true;
            var missing = collectMissingFields();
            if (missing.length > 0) {
                e.preventDefault();
                updateExtractionWarning();
                var alertEl = document.getElementById('extractionAlert');
                if (alertEl) {
                    alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                if (missing[0] && missing[0].el && typeof missing[0].el.focus === 'function') {
                    try { missing[0].el.focus(); } catch (err) { /* ignore */ }
                }
                return false;
            }
        });
    }
});
