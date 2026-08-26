/**
 * SRAAS — Upload Results (Page 2: Review & Edit)
 * Live recalculation of Total and PASS/FAIL as the admin edits marks.
 * Server-side validation still happens on submit (authoritative).
 */
document.addEventListener('DOMContentLoaded', function () {
    var rows = document.querySelectorAll('#reviewForm tbody tr[data-max-marks]');
    var PASS_PERCENT = 50; // P.G. 2022/2024: C (50-54%) is the minimum pass band

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

        internalInput.addEventListener('input', update);
        externalInput.addEventListener('input', update);

        // Clear inline error highlight as soon as the admin edits the field
        internalInput.addEventListener('input', function () {
            this.classList.remove('is-invalid');
        });
        externalInput.addEventListener('input', function () {
            this.classList.remove('is-invalid');
        });

        update();
    });
});
