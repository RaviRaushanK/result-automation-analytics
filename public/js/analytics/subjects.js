/**
 * SRAAS - Analytics Subjects (Phase 5)
 * Connects the Subjects EJS shell to /analytics/api/subjects.
 */
(function () {
  'use strict';

  const form = document.getElementById('analytics-filter-form');
  const modeBadge = document.getElementById('analytics-mode-badge');
  const modeLabel = document.getElementById('analytics-mode-label');
  const yearSel = document.getElementById('filter-academic-year');
  const semSel = document.getElementById('filter-semester');
  const examSessionSel = document.getElementById('filter-exam-session');
  const deptSel = document.getElementById('filter-department');
  const batchSel = document.getElementById('filter-batch');
  const sessionSel = document.getElementById('filter-session');
  const subjectSel = document.getElementById('filter-subject');
  const attemptSel = document.getElementById('filter-attempt');
  const modeSel = document.getElementById('filter-mode');
  const emptyState = document.getElementById('analytics-empty-state');
  const tBodyS = document.getElementById('subjects-table-body');
  const chartElS = document.getElementById('subjects-grade-chart');
  let gradeChartS = null;



  /* ---- subject table row ---- */
  function renderSubjectRow(r) {
    var t = document.createElement('tr');
    t.innerHTML = '<td>' + esc(r.subjectCode) + '</td><td>' + esc(r.subjectName) + '</td>' +
      '<td>' + (r.attempted != null ? fmtInt(r.attempted) : '\u2014') + '</td>' +
      '<td>' + (r.passed != null ? fmtInt(r.passed) : '\u2014') + '</td>' +
      '<td>' + (r.failed != null ? fmtInt(r.failed) : '\u2014') + '</td>' +
      '<td>' + (r.passPercentage != null ? fmt(r.passPercentage, 1) + '%' : '\u2014') + '</td>' +
      '<td>' + (r.avgMarks != null ? fmt(r.avgMarks, 2) : '\u2014') + '</td>' +
      '<td>' + (r.maxMarks != null ? fmt(r.maxMarks, 2) : '\u2014') + '</td>';
    return t;
  }

  /* ---- load subjects ---- */
  function loadSubjects() {
    showSkeleton(true); showEmpty(false);
    var params = readFilters();
    fetchJSON('/analytics/api/subjects' + qs(params)).then(function (j) {
      if (j.success === false) throw new Error(j.message || 'API error');
      updateModeBadge(j.mode || 'original');
      var data = j.data || [];
      if (!tBodyS) return;
      tBodyS.innerHTML = '';
      if (!data.length) {
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '8'); td.className = 'analytics-table-empty';
        td.textContent = 'No subject data found for the selected filters.';
        tr.appendChild(td); tBodyS.appendChild(tr);
        showEmpty(true); return;
      }
      data.forEach(function (r) { tBodyS.appendChild(renderSubjectRow(r)); });
      showEmpty(false);
      loadSubjectsGradeDist(params);
    }).catch(function (e) {
      console.error('Subjects error:', e);
      if (tBodyS) {
        tBodyS.innerHTML = '';
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '8'); td.className = 'analytics-table-empty';
        td.textContent = 'Unable to load analytics data. Please try again.';
        tr.appendChild(td); tBodyS.appendChild(tr);
      }
      showEmpty(true);
    });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(value, decimals) {
    return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(decimals);
  }
  function fmtInt(value) { return fmt(value, 0); }
  function showEmpty(show) { if (emptyState) emptyState.classList.toggle('d-none', !show); }
  function showSkeleton(show) {
    if (!show) return;
    tBodyS.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
    if (gradeChartS) { gradeChartS.destroy(); gradeChartS = null; }
    chartElS.textContent = 'Loading…';
  }
  function updateModeBadge(mode) {
    mode = mode === 'effective' ? 'effective' : 'original';
    modeBadge.classList.remove('is-original', 'is-effective');
    modeBadge.classList.add('is-' + mode);
    modeLabel.textContent = mode === 'effective' ? 'Effective' : 'Original';
  }
  function readFilters() {
    var params = new URLSearchParams();
    Array.from(form.elements).forEach(function (el) {
      if (el.name && el.value.trim()) params.set(el.name, el.value.trim());
    });
    return params;
  }
  function qs(params) { return '?' + params.toString(); }
  async function fetchJSON(url) {
    var response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Request failed: ' + response.status);
    var json = await response.json();
    if (json.success === false) throw new Error(json.message || 'API error');
    return json;
  }
  async function loadSubjectsGradeDist(params) {
    try {
      var json = await fetchJSON('/analytics/api/grade-distribution' + qs(params));
      var rows = json.data || [];
      chartElS.textContent = '';
      if (!rows.length || typeof Chart === 'undefined') {
        chartElS.textContent = rows.map(function (row) { return row.grade + ': ' + fmtInt(row.count); }).join(' • ') || 'No grade data found.';
        return;
      }
      var canvas = document.createElement('canvas');
      chartElS.appendChild(canvas);
      gradeChartS = new Chart(canvas, {
        type: 'bar',
        data: { labels: rows.map(function (r) { return r.grade; }), datasets: [{ label: 'Subject attempts', data: rows.map(function (r) { return r.count; }), backgroundColor: '#2563eb' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
      });
    } catch (err) { chartElS.textContent = 'Unable to load grade distribution.'; }
  }
  var filterRequest = 0;
  async function refreshDepends(changed) {
    var request = ++filterRequest;
    var definitions = [
      ['years', yearSel, 'examYear', 'examYear', 'exam_year'],
      ['semesters', semSel, 'semester', 'semester', 'semester'],
      ['departments', deptSel, 'departmentId', 'name', 'department_id'],
      ['batches', batchSel, 'batchId', 'batchName', 'batch_id'],
      ['sessions', sessionSel, 'sessionId', 'examSession', 'session_id'],
      ['subjects', subjectSel, 'subjectId', 'subjectCode', 'subject_id']
    ];
    if (changed && changed !== 'subject_id') subjectSel.value = '';
    if (changed && !['subject_id', 'session_id'].includes(changed)) sessionSel.value = '';
    if (changed === 'department_id') batchSel.value = '';
    var params = readFilters();
    await Promise.all(definitions.map(async function (def) {
      var scoped = new URLSearchParams(params);
      scoped.delete(def[4]);
      if (def[0] !== 'subjects') scoped.delete('subject_id');
      if (!['subjects', 'sessions'].includes(def[0])) scoped.delete('session_id');
      if (def[0] === 'departments') scoped.delete('batch_id');
      try {
        var json = await fetchJSON('/analytics/api/filter-options/' + def[0] + qs(scoped));
        if (request !== filterRequest) return;
        var previous = def[1].value;
        def[1].innerHTML = '<option value="">All</option>';
        (json.data || []).forEach(function (row) {
          var option = document.createElement('option');
          option.value = String(row[def[2]]);
          option.textContent = String(row[def[3]]);
          def[1].appendChild(option);
        });
        def[1].value = previous;
      } catch (err) { console.error('Unable to load filter options', err); }
    }));
  }
  form.addEventListener('submit', function (event) { event.preventDefault(); loadSubjects(); });
  form.addEventListener('reset', function () {
    setTimeout(function () { refreshDepends(); loadSubjects(); }, 0);
  });
  [yearSel, semSel, deptSel, batchSel, sessionSel, subjectSel].forEach(function (el) {
    el.addEventListener('change', function () { refreshDepends(el.name); });
  });
  modeSel.addEventListener('change', loadSubjects);
  refreshDepends();
  loadSubjects();
})();

