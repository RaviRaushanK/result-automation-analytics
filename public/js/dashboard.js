/* ============================================
   Dashboard - SRAAS
   Loads statistics, top scorers, and charts
   ============================================ */

document.addEventListener('DOMContentLoaded', function () {
    // Chart instances (destroyed/recreated on filter change)
    let subjectAverageChart = null;
    let passFailPieChart = null;
    let passFailDoughnutChart = null;

    // DOM references
    const yearSelect = document.getElementById('filterAcademicYear');
    const semesterSelect = document.getElementById('filterSemester');
    const applyBtn = document.getElementById('applyFilterBtn');
    const resetBtn = document.getElementById('resetFilterBtn');
    const topScorersBody = document.querySelector('#topScorersTable tbody');

    // Exposed EJS variables (via data attributes on hidden div)
    const filtersEl = document.getElementById('dashboardFilters');
    const filters = {
        academicYears: filtersEl ? JSON.parse(filtersEl.dataset.academicYears || '[]') : [],
        semesters: filtersEl ? JSON.parse(filtersEl.dataset.semesters || '[]') : []
    };

    // ---------- Populate filter dropdowns ----------
    function populateFilters() {
        (filters.academicYears || []).forEach(function (year) {
            const opt = document.createElement('option');
            opt.value = year;
            opt.textContent = year;
            yearSelect.appendChild(opt);
        });
        (filters.semesters || []).forEach(function (sem) {
            const opt = document.createElement('option');
            opt.value = sem;
            opt.textContent = sem;
            semesterSelect.appendChild(opt);
        });
    }

    // ---------- Build query string ----------
    function buildQuery() {
        const params = new URLSearchParams();
        if (yearSelect.value) params.set('academicYear', yearSelect.value);
        if (semesterSelect.value) params.set('semester', semesterSelect.value);
        const qs = params.toString();
        return qs ? '?' + qs : '';
    }

    // ---------- Fetch helpers ----------
    async function fetchJSON(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    // ---------- Statistics ----------
    async function loadStatistics() {
        const ids = [
            'totalStudents', 'totalPass', 'totalFail',
            'passPercentage', 'failPercentage', 'totalSubjects',
            'highestScore', 'averageCGPA'
        ];
        ids.forEach(function (id) {
            setText(id, '--');
        });

        try {
            const json = await fetchJSON('/dashboard/analytics' + buildQuery());
            const stats = (json.data && json.data.statistics) || {};
            setText('totalStudents', stats.totalStudents != null ? stats.totalStudents : '--');
            setText('totalPass', stats.totalPass != null ? stats.totalPass : '--');
            setText('totalFail', stats.totalFail != null ? stats.totalFail : '--');
            setText('passPercentage', stats.passPercentage != null ? stats.passPercentage + '%' : '--');
            setText('failPercentage', stats.failPercentage != null ? stats.failPercentage + '%' : '--');
            setText('totalSubjects', stats.totalSubjects != null ? stats.totalSubjects : '--');
            setText('highestScore', stats.highestScore != null ? stats.highestScore : '--');
            setText('averageCGPA', stats.averageCGPA != null ? stats.averageCGPA : '--');
            return (json.data && json.data.subjectAverages) || [];
        } catch (err) {
            console.error('Failed to load statistics:', err);
            ids.forEach(function (id) {
                setText(id, '--');
            });
            return [];
        }
    }

    // ---------- Top Scorers ----------
    async function loadTopScorers() {
        topScorersBody.innerHTML =
            '<tr>' +
            '  <td colspan="6" class="text-center table-loading">' +
            '    <div class="spinner-border spinner-border-sm text-primary" role="status">' +
            '      <span class="visually-hidden">Loading...</span>' +
            '    </div>' +
            '    <span class="ms-2 text-muted">Loading top scorers...</span>' +
            '  </td>' +
            '</tr>';

        try {
            const json = await fetchJSON('/dashboard/top-scorers' + buildQuery());
            const scorers = json.data || [];
            if (!scorers.length) {
                topScorersBody.innerHTML =
                    '<tr><td colspan="6" class="text-center text-muted py-4">No results found.</td></tr>';
                return;
            }
            topScorersBody.innerHTML = scorers.map(function (s, i) {
                const statusClass = s.result_status === 'pass' ? 'badge-pass' : 'badge-fail';
                return (
                    '<tr>' +
                    '  <td>' + (i + 1) + '</td>' +
                    '  <td><span class="text-muted">' + escapeHtml(s.usn) + '</span></td>' +
                    '  <td class="fw-medium">' + escapeHtml(s.student_name) + '</td>' +
                    '  <td>' + (s.sgpa != null ? s.sgpa : '--') + '</td>' +
                    '  <td>' + (s.cgpa != null ? s.cgpa : '--') + '</td>' +
                    '  <td><span class="badge-status ' + statusClass + '">' + escapeHtml(s.result_status) + '</span></td>' +
                    '</tr>'
                );
            }).join('');
        } catch (err) {
            console.error('Failed to load top scorers:', err);
            topScorersBody.innerHTML =
                '<tr><td colspan="6" class="text-center text-danger py-4">Failed to load top scorers.</td></tr>';
        }
    }

    // ---------- Subject Average Chart ----------
    function renderSubjectChart(subjectAverages) {
        const ctx = document.getElementById('subjectAverageChart');
        if (!ctx) return;
        if (subjectAverageChart) subjectAverageChart.destroy();

        const labels = subjectAverages.map(function (s) { return s.subject_name; });
        const data = subjectAverages.map(function (s) { return s.average_marks; });

        subjectAverageChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Average Marks',
                    data: data,
                    backgroundColor: 'rgba(37, 99, 235, 0.75)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function (value) { return value; }
                        }
                    }
                }
            }
        });
    }

    // ---------- Pass/Fail Charts ----------
    function renderPassFailCharts(pass, fail) {
        const pieCtx = document.getElementById('passFailPieChart');
        const doughnutCtx = document.getElementById('passFailDoughnutChart');

        const data = {
            labels: ['Pass', 'Fail'],
            datasets: [{
                data: [pass, fail],
                backgroundColor: ['rgba(40, 167, 69, 0.85)', 'rgba(220, 53, 69, 0.85)'],
                borderColor: ['rgba(40, 167, 69, 1)', 'rgba(220, 53, 69, 1)'],
                borderWidth: 1
            }]
        };

        if (pieCtx) {
            if (passFailPieChart) passFailPieChart.destroy();
            passFailPieChart = new Chart(pieCtx, {
                type: 'pie',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }

        if (doughnutCtx) {
            if (passFailDoughnutChart) passFailDoughnutChart.destroy();
            passFailDoughnutChart = new Chart(doughnutCtx, {
                type: 'doughnut',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%',
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
    }

    // ---------- Pass/Fail data ----------
    async function loadPassFail() {
        try {
            const json = await fetchJSON('/dashboard/pass-fail' + buildQuery());
            const data = json.data || {};
            renderPassFailCharts(data.pass || 0, data.fail || 0);
        } catch (err) {
            console.error('Failed to load pass/fail data:', err);
            renderPassFailCharts(0, 0);
        }
    }

    // ---------- Load everything ----------
    async function loadDashboard() {
        const subjectAverages = await loadStatistics();
        renderSubjectChart(subjectAverages);
        await loadTopScorers();
        await loadPassFail();
    }

    // ---------- Event listeners ----------
    applyBtn.addEventListener('click', function () {
        loadDashboard();
    });
    resetBtn.addEventListener('click', function () {
        yearSelect.value = '';
        semesterSelect.value = '';
        loadDashboard();
    });

    // ---------- Init ----------
    populateFilters();
    loadDashboard();
});