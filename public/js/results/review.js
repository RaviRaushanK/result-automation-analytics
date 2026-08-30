/**
 * SRAAS — Upload Results (Page 2: Review & Edit)
 * Live recalculation of Total and PASS/FAIL as the admin edits marks.
 * Extraction-result validation: warns on missing required fields and
 * blocks the submit while any required field is empty. Server-side
 * validation still happens on submit (authoritative).
 */
document.addEventListener('DOMContentLoaded', function () {
    var rows = document.querySelectorAll('#reviewForm tbody tr[data-max-marks]');
    var PASS_PERCENT = 50; // P.G. 2022/2024: C (50-54%) is the minimum pass band
    var form = document.getElementById('reviewForm');

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

        rows.forEach(function (row) {
            var internalInput = row.querySelector('.internal-input');
            var externalInput = row.querySelector('.external-input');
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
                }
            });
        });

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
            if (!el.dataset.serverInvalid) el.classList.remove('is-invalid');
        });

        var missing = collectMissingFields();

        missing.forEach(function (m) {
            if (m.el && m.el.classList) m.el.classList.add('is-invalid');
        });

        // Append a single field-level warning message under each affected input
        // only if the server didn't already render one.
        var seen = {};
        missing.forEach(function (m) {
            if (!m.el) return;
            if (seen[m.field]) return;
            seen[m.field] = true;

            var existing = m.el.parentNode.querySelector('.field-error-message');
            if (existing) return; // already server-rendered, leave it

            var msg = document.createElement('div');
            msg.className = 'field-error-message text-danger small mt-1';
            msg.textContent = m.message;
            m.el.parentNode.appendChild(msg);
        });

        if (missing.length === 0) {
            if (alertEl) alertEl.style.display = 'none';
            return;
        }

        var count = missing.length;
        var noun = (count === 1) ? 'field needs' : 'fields need';
        var text = 'Some required fields could not be extracted. Please review and correct the highlighted fields before submitting the result. (' + count + ' ' + noun + ' attention.)';
        if (msgEl) msgEl.textContent = text;
        if (alertEl) alertEl.style.display = '';
    }

    rows.forEach(function (row) {
        var internalInput = row.querySelector('.internal-input');
        var externalInput = row.querySelector('.external-input');
        var totalCell = row.querySelector('.total-cell');
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

            // Score Range (%) against this subject's max_marks
            var pct = maxMarks > 0 ? Math.floor((total / maxMarks) * 100) : 0;
            

            if (pct >= PASS_PERCENT) {
                statusCell.innerHTML = '<span class="badge bg-success">PASS</span>';
            } else {
                statusCell.innerHTML = '<span class="badge bg-danger">FAIL</span>';
            }
        }

        internalInput.addEventListener('input', function () {
            update();
            updateExtractionWarning();
            this.classList.remove('is-invalid');
        });
        externalInput.addEventListener('input', function () {
            update();
            updateExtractionWarning();
            this.classList.remove('is-invalid');
        });

        update();
    });

    // Live revalidation of student name + USN fields.
    var usnEl = document.getElementById('usnInput');
    var nameEl = document.getElementById('studentNameInput');
    if (usnEl) {
        usnEl.addEventListener('input', function () {
            this.classList.remove('is-invalid');
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

    // Submit-time guard: same validation, never trust the browser submit.
    if (form) {
        form.addEventListener('submit', function (e) {
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
