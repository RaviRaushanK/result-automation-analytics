/* Dashboard: original result attempts, scoped charts and report drill-downs. */
document.addEventListener('DOMContentLoaded', function () {
    'use strict';
    const page = document.querySelector('.dashboard-page');
    if (!page) return;
    const $ = id => document.getElementById(id);
    const batch = $('filterBatch'), semester = $('filterSemester'), filters = $('dashboardFilters');
    const batches = JSON.parse(filters.dataset.batches || '[]');
    const semesters = JSON.parse(filters.dataset.semesters || '[]');
    const batchSemesters = JSON.parse(filters.dataset.batchSemesters || 'null');
    const canReview = page.dataset.canReview === 'true', charts = {};
    const statIds = ['totalStudents', 'totalPass', 'totalFail', 'passPercentage', 'failPercentage', 'totalSubjects', 'highestScore', 'averageCGPA'];
    let requestId = 0, controller = null, subjects = [], grades = [], loadedScope = null, lastData = null;
    const escapeHtml = value => {
        const el = document.createElement('span'); el.textContent = value == null ? '' : String(value); return el.innerHTML;
    };
    const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const show = (id, visible) => $(id).classList.toggle('d-none', !visible);
    const text = (id, value) => { $(id).textContent = value == null ? '--' : value; };
    const scope = () => ({ batch_id: batch.value, semester: semester.value });
    function url(path, values, extra) {
        const params = new URLSearchParams();
        Object.entries(Object.assign({}, values, extra)).forEach(([key, value]) => { if (value != null && value !== '') params.set(key, value); });
        return path + (params.size ? '?' + params : '');
    }
    function analyticsUrl(path, values, extra) {
        return url(path, values, Object.assign({ mode: 'original', attempt: 'all' }, extra));
    }
    function updateLinks(selected) {
        document.querySelectorAll('[data-dashboard-link]').forEach(link => {
            link.href = link.dataset.dashboardLink.startsWith('/analytics') ? analyticsUrl(link.dataset.dashboardLink, selected) : url(link.dataset.dashboardLink, selected, { mode: 'original' });
        });
    }
    function semesterOptions(preferred) {
        const values = batchSemesters === null ? semesters : batchSemesters.filter(s => String(s.batch_id) === batch.value).map(s => String(s.semester));
        semester.replaceChildren(new Option('All Semesters', ''));
        [...new Set(values.map(String))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).forEach(s => semester.add(new Option('Semester ' + s, s)));
        semester.value = values.map(String).includes(String(preferred)) ? String(preferred) : '';
    }
    function destroy(id) { if (charts[id]) charts[id].destroy(); delete charts[id]; }
    function colors() {
        const css = getComputedStyle(document.documentElement);
        return { text: css.getPropertyValue('--text-secondary').trim(), grid: css.getPropertyValue('--card-border').trim() };
    }
    function tooltipLines(value) {
        const lines = [''];
        String(value || '').split(/\s+/).forEach(word => {
            (word.match(/.{1,32}/g) || []).forEach(part => {
                const last = lines.length - 1;
                if (lines[last] && lines[last].length + part.length + 1 > 32) lines.push(part);
                else lines[last] += (lines[last] ? ' ' : '') + part;
            });
        });
        return lines;
    }
    function options() {
        const c = colors();
        return {
            responsive: true, maintainAspectRatio: false,
            animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: c.text } } },
            scales: { x: { ticks: { color: c.text }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: c.text }, grid: { color: c.grid } } }
        };
    }
    function sortedSubjects() {
        return subjects.slice().sort((a, b) => {
            if ($('subjectChartOrder').value === 'code') return a.subject_code.localeCompare(b.subject_code);
            const key = $('subjectChartOrder').value === 'failures' ? 'failed' : 'average_marks';
            return Number(b[key]) - Number(a[key]) || a.subject_code.localeCompare(b.subject_code);
        });
    }
    function renderSubjectChart() {
        destroy('subjectAverageChart');
        const rows = sortedSubjects();
        $('subjectAverageMessage').textContent = rows.length ? '' : 'No subject data for this selection.';
        show('subjectAverageMessage', !rows.length);
        if (!rows.length) return;
        $('subjectAverageChartWrap').style.width = Math.max(rows.length * 80, 0) + 'px';
        const config = options();
        config.plugins.legend.display = false;
        config.scales.y.title = { display: true, text: 'Average marks', color: colors().text };
        config.plugins.tooltip = { callbacks: {
            title: items => rows[items[0].dataIndex].subject_code,
            afterTitle: items => tooltipLines(rows[items[0].dataIndex].subject_name),
            afterLabel: item => { const row = rows[item.dataIndex]; return ['Maximum: ' + row.max_marks, 'Failed attempts: ' + row.failed + ' / ' + row.attempted]; }
        } };
        config.onClick = (event, items) => {
            if (canReview && items.length && loadedScope) window.location.assign(analyticsUrl('/analytics/subjects', loadedScope, { subject_id: rows[items[0].index].subject_id }));
        };
        charts.subjectAverageChart = new Chart($('subjectAverageChart'), { type: 'bar', data: {
            labels: rows.map(s => s.subject_code), datasets: [{ label: 'Average marks', data: rows.map(s => s.average_marks), backgroundColor: '#3b82f6', borderRadius: 4, maxBarThickness: 44 }]
        }, options: config });
    }
    function renderPassFail(stats) {
        destroy('passFailPieChart');
        const passed = Number(stats.totalPass || 0), failed = Number(stats.totalFail || 0), total = passed + failed;
        text('chartPassedCount', passed); text('chartFailedCount', failed);
        $('passFailEmpty').hidden = total > 0; $('passFailChartWrap').hidden = total === 0;
        if (!total) return;
        charts.passFailPieChart = new Chart($('passFailPieChart'), {
            type: 'pie',
            data: { labels: ['Passed attempts', 'Failed attempts'], datasets: [{ data: [passed, failed], backgroundColor: ['#16a34a', '#e05252'], borderWidth: 0, hoverOffset: 6 }] },
            options: { responsive: true, maintainAspectRatio: false,
                animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
                plugins: { legend: { position: 'bottom', labels: { color: colors().text } },
                    tooltip: { callbacks: { label: item => item.label + ': ' + item.raw + ' (' + (Number(item.raw) / total * 100).toFixed(1) + '%)' } } }
            }
        });
    }
    function renderGradeChart() {
        destroy('gradeDistributionChart');
        $('gradeEmpty').hidden = grades.length > 0; $('gradeChartArea').hidden = grades.length === 0;
        text('gradedAttemptCount', lastData.gradeSummary.graded); text('missingGradeCount', lastData.gradeSummary.missing);
        $('gradeBreakdownBody').innerHTML = grades.map(row => '<tr><th scope="row">' + escapeHtml(row.grade) + '</th><td>' + escapeHtml(row.count) + '</td><td>' + escapeHtml(row.percentage) + '%</td></tr>').join('') || '<tr><td colspan="3" class="text-muted">No subject grades available.</td></tr>';
        if (!grades.length) return;
        $('gradeChartArea').style.height = Math.max(320, grades.length * 36 + 45) + 'px';
        const config = options();
        config.indexAxis = 'y';
        config.plugins.legend.display = false;
        config.scales.x.beginAtZero = true; config.scales.x.ticks.precision = 0;
        config.scales.x.grid = { color: colors().grid };
        config.scales.x.title = { display: true, text: 'Subject attempts', color: colors().text };
        config.scales.y.grid = { display: false };
        config.interaction.axis = 'y';
        config.plugins.tooltip = { callbacks: { afterLabel: item => grades[item.dataIndex].percentage + '% of subject attempts' } };
        const palette = { O: '#16a34a', 'A+': '#0891b2', A: '#3b82f6', 'B+': '#8b5cf6', B: '#d97706', C: '#64748b', F: '#e05252' };
        charts.gradeDistributionChart = new Chart($('gradeDistributionChart'), { type: 'bar', data: {
            labels: grades.map(row => row.grade),
            datasets: [{ label: 'Subject attempts', data: grades.map(row => row.count), backgroundColor: grades.map(row => palette[row.grade] || '#64748b'), borderRadius: 4, maxBarThickness: 22 }]
        }, options: config });
    }
    function renderAttention() {
        const rows = subjects.filter(s => Number(s.failed) > 0).sort((a, b) => b.failed - a.failed || a.pass_percentage - b.pass_percentage || a.subject_code.localeCompare(b.subject_code)).slice(0, 5);
        $('dashboardAttentionBody').innerHTML = rows.length ? rows.map(s => {
            const label = '<strong>' + escapeHtml(s.subject_code) + '</strong><span class="dashboard-subject-name">' + escapeHtml(s.subject_name) + '</span>';
            const name = canReview ? '<a class="dashboard-record-link" href="' + escapeHtml(analyticsUrl('/analytics/subjects', loadedScope, { subject_id: s.subject_id })) + '">' + label + '</a>' : label;
            return '<tr><td>' + name + '</td><td><span class="dashboard-failed-count">' + escapeHtml(s.failed) + '</span> / ' + escapeHtml(s.attempted) + '</td><td>' + escapeHtml(s.pass_percentage) + '%</td></tr>';
        }).join('') : '<tr><td colspan="3" class="text-muted py-4">' + (subjects.length ? 'No failed subject attempts in this selection.' : 'No subject results in this selection.') + '</td></tr>';
    }
    function renderScorers(rows, selected) {
        document.querySelector('#topScorersTable tbody').innerHTML = rows.length ? rows.map((s, i) => {
            const name = canReview && s.student_id ? '<a class="dashboard-record-link" href="' + escapeHtml(url('/reports/student', { batch_id: s.batch_id || selected.batch_id, student_id: s.student_id, session_id: s.session_id, attempt_no: s.attempt_no, semester: selected.semester, mode: 'original' })) + '">' + escapeHtml(s.student_name) + '</a>' : escapeHtml(s.student_name);
            return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(s.usn) + '</td><td>' + name + '</td><td>' + escapeHtml(s.sgpa == null ? '--' : s.sgpa) + '</td><td>' + escapeHtml(s.cgpa == null ? '--' : s.cgpa) + '</td><td><span class="badge-status badge-pass">Pass</span></td></tr>';
        }).join('') : '<tr><td colspan="6" class="text-muted text-center py-4">No passing attempts with stored CGPA in this selection.</td></tr>';
    }
    function render(data, rows, selected) {
        const stats = data.statistics;
        statIds.forEach(id => {
            const value = number(stats[id]); text(id, value == null ? '--' : ['passPercentage', 'failPercentage'].includes(id) ? value + '%' : id === 'averageCGPA' ? value.toFixed(2) : value);
        });
        subjects = data.subjectAverages; grades = data.gradeDistribution; lastData = data; loadedScope = selected;
        renderSubjectChart(); renderPassFail(stats); renderGradeChart(); renderAttention(); renderScorers(rows, selected);
        text('dashboardScope', (batch.selectedOptions[0]?.textContent || 'No batch') + ' / ' + (selected.semester ? 'Semester ' + selected.semester : 'All semesters') + ' - Original results / All attempts');
        show('dashboardEmpty', Number(stats.totalPass || 0) + Number(stats.totalFail || 0) === 0);
        updateLinks(selected);
    }
    async function fetchJSON(path, selected, signal) {
        const response = await fetch(url(path, selected), { signal, headers: { Accept: 'application/json' } });
        if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Unable to load dashboard data.');
        const json = await response.json();
        if (!json.success || !json.data) throw new Error('Unable to load dashboard data.');
        if (path.endsWith('/analytics') ? !json.data.statistics || !Array.isArray(json.data.subjectAverages) || !Array.isArray(json.data.gradeDistribution) || !json.data.gradeSummary : !Array.isArray(json.data)) throw new Error('Invalid dashboard response.');
        return json.data;
    }
    async function loadDashboard() {
        const version = ++requestId;
        if (controller) controller.abort();
        controller = new AbortController();
        const selected = scope();
        updateLinks(selected);
        $('subjectChartOrder').disabled = true;
        page.setAttribute('aria-busy', 'true'); text('dashboardUpdated', 'Loading...');
        show('dashboardError', false); show('dashboardEmpty', false);
        loadedScope = null; lastData = null; subjects = []; grades = [];
        Object.keys(charts).forEach(destroy); statIds.forEach(id => text(id, null));
        text('chartPassedCount', null); text('chartFailedCount', null);
        text('gradedAttemptCount', null); text('missingGradeCount', null); $('gradeBreakdownBody').replaceChildren();
        text('dashboardScope', (batch.selectedOptions[0]?.textContent || 'No batch') + ' / ' + (selected.semester ? 'Semester ' + selected.semester : 'All semesters') + ' - Original results / All attempts');
        document.querySelector('#topScorersTable tbody').innerHTML = '<tr><td colspan="6" class="text-muted text-center py-4">Loading...</td></tr>';
        $('dashboardAttentionBody').innerHTML = '<tr><td colspan="3" class="text-muted">Loading...</td></tr>';
        if (!selected.batch_id) {
            render({ statistics: { totalStudents: 0, totalPass: 0, totalFail: 0, passPercentage: 0, failPercentage: 0, totalSubjects: 0, highestScore: null, averageCGPA: null }, subjectAverages: [], gradeDistribution: [], gradeSummary: { graded: 0, missing: 0, total: 0 } }, [], selected);
            text('dashboardUpdated', 'No batches available'); page.setAttribute('aria-busy', 'false');
            return;
        }
        try {
            const [data, scorers] = await Promise.all([
                fetchJSON('/dashboard/analytics', selected, controller.signal),
                fetchJSON('/dashboard/top-scorers', selected, controller.signal)
            ]);
            if (version !== requestId) return;
            render(data, scorers, selected);
            text('dashboardUpdated', 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } catch (error) {
            if (version !== requestId || error.name === 'AbortError') return;
            $('dashboardError').textContent = 'Unable to load this selection. Refresh to try again.';
            show('dashboardError', true); text('dashboardUpdated', 'Not updated');
            document.querySelector('#topScorersTable tbody').innerHTML = '<tr><td colspan="6" class="text-muted">Results unavailable.</td></tr>';
            $('dashboardAttentionBody').innerHTML = '<tr><td colspan="3" class="text-muted">Results unavailable.</td></tr>';
        } finally {
            if (version === requestId) { page.setAttribute('aria-busy', 'false'); $('subjectChartOrder').disabled = false; }
        }
    }
    batches.forEach(b => batch.add(new Option(b.batch_name, b.batch_id)));
    const initial = new URLSearchParams(location.search);
    if ([...batch.options].some(o => o.value === initial.get('batch_id'))) batch.value = initial.get('batch_id');
    semesterOptions(initial.get('semester'));
    batch.addEventListener('change', () => { semesterOptions(semester.value); loadDashboard(); });
    semester.addEventListener('change', loadDashboard);
    $('dashboardFilterForm').addEventListener('submit', event => { event.preventDefault(); loadDashboard(); });
    $('applyFilterBtn').addEventListener('click', loadDashboard);
    $('resetFilterBtn').addEventListener('click', () => { batch.selectedIndex = batches.length ? 0 : -1; semesterOptions(''); loadDashboard(); });
    $('subjectChartOrder').addEventListener('change', () => { if (loadedScope) renderSubjectChart(); });
    new MutationObserver(() => {
        if (!loadedScope || !lastData) return;
        renderSubjectChart(); renderPassFail(lastData.statistics); renderGradeChart();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    loadDashboard();
});
