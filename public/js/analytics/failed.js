/**
 * SRAAS - Analytics Failed Students (Phase 5)
 * Connects the Failed EJS shell to /analytics/api/failed.
 * Displays recorded failed subject results with original vs effective columns.
 */
(function () {
  'use strict';

  const form = document.getElementById('analytics-filter-form');
  const modeBadge = document.getElementById('analytics-mode-badge');
  const modeLabel = document.getElementById('analytics-mode-label');
  const yearSel = document.getElementById('filter-academic-year');
  const semSel = document.getElementById('filter-semester');
  const deptSel = document.getElementById('filter-department');
  const batchSel = document.getElementById('filter-batch');
  const sessionSel = document.getElementById('filter-session');
  const subjectSel = document.getElementById('filter-subject');
  const attemptSel = document.getElementById('filter-attempt');
  const modeSel = document.getElementById('filter-mode');
  const emptyState = document.getElementById('analytics-empty-state');

  const cardStudents = document.querySelector('[data-metric="failed-students"] .stat-value');
  const cardAttempts = document.querySelector('[data-metric="failed-subject-attempts"] .stat-value');
  const cardSubjects = document.querySelector('[data-metric="subjects-with-failures"] .stat-value');
  const tableBody = document.getElementById('failed-table-body');

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function fmt(n, d) {
    if (n == null || n === '' || isNaN(n)) return '\u2014';
    return Number(n).toFixed(d);
  }

  function fmtInt(n) { return fmt(n, 0); }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function textColor() {
    return getTheme() === 'dark' ? '#CBD5E1' : '#4B5563';
  }

  function setCard(el, v) { if (el) el.textContent = v; }

  function updateModeBadge(mode) {
    if (!modeBadge || !modeLabel) return;
    modeBadge.classList.remove('is-original', 'is-effective');
    modeBadge.classList.add('is-' + mode);
    modeLabel.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  function showEmpty(show) {
    if (!emptyState) return;
    emptyState.classList.toggle('d-none', !show);
  }

  function showSkeleton(show) {
    if (show) {
      var cards = [cardStudents, cardAttempts, cardSubjects];
      cards.forEach(function (c) { if (c) c.textContent = '\u2014'; });
      if (tableBody) {
        tableBody.innerHTML = '';
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '7');
        td.className = 'analytics-table-empty';
        td.textContent = 'Loading\u2026';
        tr.appendChild(td);
        tableBody.appendChild(tr);
      }
      if (emptyState) emptyState.classList.add('d-none');
    }
  }

  function readFilters() {
    var p = new URLSearchParams();
    var v = function (sel) { var s = sel.value.trim(); return s ? s : null; };
    var y = v(yearSel), s = v(semSel), d = v(deptSel), b = v(batchSel), ss = v(sessionSel);
    var subj = v(subjectSel), att = attemptSel.value.trim(), m = modeSel.value.trim();
    if (y) p.set('exam_year', y);
    if (s) p.set('semester', s);
    if (d) p.set('department_id', d);
    if (b) p.set('batch_id', b);
    if (ss) p.set('session_id', ss);
    if (subj) p.set('subject_id', subj);
    if (att && att !== 'latest') p.set('attempt', att);
    if (m) p.set('mode', m);
    return p;
  }

  function qs(p) { return p.toString() ? '?' + p.toString() : ''; }

  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      var ct = (r.headers.get('content-type') || '');
      if (!r.ok || ct.indexOf('application/json') === -1)
        throw new Error('Request failed: HTTP ' + r.status);
      return r.json();
    });
  }

  var optionCache = {};
  var optionInflight = {};

  function loadFilterOptions(scope, params) {
    var key = scope + '|' + params.toString();
    if (optionCache[key]) return Promise.resolve(optionCache[key]);
    if (optionInflight[key]) return optionInflight[key];
    var url = '/analytics/api/filter-options/' + encodeURIComponent(scope) + qs(params);
    var promise = fetchJSON(url).then(function (json) {
      var data = json.data || [];
      optionCache[key] = data;
      return data;
    }).catch(function (err) {
      console.error('Failed to load filter options for ' + scope, err);
      return [];
    });
    optionInflight[key] = promise;
    return promise.finally(function () { delete optionInflight[key]; });
  }

  function populateSelect(sel, items, valueKey, textKey, placeholder) {
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">' + (placeholder || 'All') + '</option>';
    (items || []).forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = String(item[valueKey] || '');
      opt.textContent = String(item[textKey] || item[valueKey] || '');
      sel.appendChild(opt);
    });
    if (prev && items.some(function (i) { return String(i[valueKey]) === prev; })) {
      sel.value = prev;
    } else {
      sel.value = '';
    }
  }

  function refreshDepends(changed) {
    var params = readFilters();
    if (changed === 'exam_year' || changed === 'all') {
      loadFilterOptions('years', params).then(function (items) {
        populateSelect(yearSel, items, 'examYear', 'examYear', 'All Academic Years');
      });
      loadFilterOptions('semesters', params).then(function (items) {
        populateSelect(semSel, items, 'semester', 'semester', 'All Semesters');
        if (!semSel.value) { deptSel.value = ''; batchSel.value = ''; sessionSel.value = ''; subjectSel.value = ''; }
      });
    }
    if (changed === 'semester' || changed === 'all') {
      loadFilterOptions('departments', params).then(function (items) {
        populateSelect(deptSel, items, 'departmentId', 'name', 'All Departments');
        if (!deptSel.value) { batchSel.value = ''; sessionSel.value = ''; subjectSel.value = ''; }
      });
    }
    if (changed === 'department' || changed === 'all') {
      loadFilterOptions('batches', params).then(function (items) {
        populateSelect(batchSel, items, 'batchId', 'batchName', 'All Batches');
        if (!batchSel.value) { sessionSel.value = ''; subjectSel.value = ''; }
      });
    }
    if (changed === 'batch' || changed === 'all') {
      loadFilterOptions('sessions', params).then(function (items) {
        populateSelect(sessionSel, items, 'sessionId', 'examSession', 'All Sessions');
      });
    }
  }

  function statusBadge(status) {
    var cls = 'analytics-status';
    var icon = 'help_outline';
    if (status === 'pass') { cls += ' pass'; icon = 'check_circle'; }
    else if (status === 'fail') { cls += ' fail'; icon = 'cancel'; }
    return '<span class="' + cls + '"><span class="material-icons" aria-hidden="true">' + icon + '</span> ' +
      esc(status ? status.toUpperCase() : '\u2014') + '</span>';
  }

  function renderRow(row) {
    var tr = document.createElement('tr');
    // Original mode returns stored values (marks/resultStatus); effective mode also
    // returns original* plus the approved overlay values (revised*).
    var originalMarks = row.originalMarks != null ? row.originalMarks : row.marks;
    var originalStatus = row.originalStatus != null ? row.originalStatus : row.resultStatus;
    tr.innerHTML =
      '<td>' + esc(row.usn) + '</td>' +
      '<td>' + esc(row.studentName) + '</td>' +
      '<td>' + esc(row.subjectName) + '</td>' +
      '<td>' + (originalMarks != null ? fmtInt(originalMarks) : '\u2014') + '</td>' +
      '<td>' + (row.revisedMarks != null ? fmtInt(row.revisedMarks) : '\u2014') + '</td>' +
      '<td>' + statusBadge(originalStatus) + '</td>' +
      '<td>' + statusBadge(row.revisedStatus) + '</td>';
    return tr;
  }

  function distinctCount(rows, field) {
    var seen = {};
    var count = 0;
    (rows || []).forEach(function (row) {
      var key = row && row[field];
      if (key == null || key === '') return;
      if (seen[key]) return;
      seen[key] = true;
      count++;
    });
    return count;
  }

  /**
   * Charts read only the records already returned by /analytics/api/failed for
   * the current filters - no totals are inferred beyond what is listed.
   */
  function renderCharts(rows) {
    var api = window.AnalyticsCharts;
    if (!api) return;

    var bySubject = {};
    (rows || []).forEach(function (row) {
      var name = row.subjectName || row.subjectCode || 'Unknown';
      bySubject[name] = (bySubject[name] || 0) + 1;
    });
    var subjectNames = Object.keys(bySubject).sort(function (a, b) {
      return bySubject[b] - bySubject[a];
    }).slice(0, 10);
    api.render('failed-subject-chart', {
      type: 'bar',
      horizontal: true,
      labels: subjectNames,
      datasets: [{
        label: 'Failure records',
        palette: true,
        data: subjectNames.map(function (name) { return bySubject[name]; })
      }],
      decimals: 0,
      emptyMessage: 'No failure records listed for the current filters.'
    });

    var byStatus = {};
    (rows || []).forEach(function (row) {
      var status = row.revisedStatus || row.originalStatus || 'unknown';
      var key = String(status).toUpperCase();
      byStatus[key] = (byStatus[key] || 0) + 1;
    });
    var statusKeys = Object.keys(byStatus);
    api.render('failed-status-chart', {
      type: 'doughnut',
      labels: statusKeys,
      datasets: [{ label: 'Records', data: statusKeys.map(function (k) { return byStatus[k]; }) }],
      decimals: 0,
      emptyMessage: 'No status values in the listed records.'
    });
  }

  function refreshTable() {
    if (window.AnalyticsTable) window.AnalyticsTable.refresh('failed-table');
  }

  function loadFailed() {
    showSkeleton(true);
    showEmpty(false);
    var params = readFilters();
    params.set('limit', '50');
    var url = '/analytics/api/failed' + qs(params);
    fetchJSON(url).then(function (json) {
      if (json.success === false) throw new Error(json.message || 'API error');
      updateModeBadge(json.mode || 'original');
      var d = json;
      var summary = d.summary || {};
      var data = d.data || [];

      // Prefer service-level aggregates when the API supplies them; otherwise
      // describe the records actually listed for these filters.
      setCard(cardStudents, fmtInt(summary.failedStudents != null
        ? summary.failedStudents : distinctCount(data, 'usn')));
      setCard(cardAttempts, fmtInt(summary.failedSubjectAttempts != null
        ? summary.failedSubjectAttempts : data.length));
      setCard(cardSubjects, fmtInt(summary.subjectsWithFailures != null
        ? summary.subjectsWithFailures : distinctCount(data, 'subjectName')));

      if (!tableBody) return;
      tableBody.innerHTML = '';
      if (!data.length) {
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '7');
        td.className = 'analytics-table-empty';
        td.textContent = 'No failed subject results found for the selected filters.';
        tr.appendChild(td);
        tableBody.appendChild(tr);
        showEmpty(true);
        renderCharts([]);
        refreshTable();
        return;
      }
      data.forEach(function (row) { tableBody.appendChild(renderRow(row)); });
      showEmpty(false);
      renderCharts(data);
      refreshTable();
    }).catch(function (err) {
      console.error('Failed students load error:', err);
      setCard(cardStudents, '\u2014'); setCard(cardAttempts, '\u2014'); setCard(cardSubjects, '\u2014');
      renderCharts([]);
      if (tableBody) {
        tableBody.innerHTML = '';
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '7');
        td.className = 'analytics-table-empty';
        td.textContent = 'Unable to load analytics data. Please try again.';
        tr.appendChild(td);
        tableBody.appendChild(tr);
      }
      showEmpty(true);
      refreshTable();
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); loadFailed(); });
    form.addEventListener('reset', function () {
      yearSel.value = ''; semSel.value = ''; deptSel.value = ''; batchSel.value = '';
      sessionSel.value = ''; subjectSel.value = ''; attemptSel.value = 'latest'; modeSel.value = 'original';
      updateModeBadge('original');
    });
  }
  if (yearSel) yearSel.addEventListener('change', function () { refreshDepends('exam_year'); });
  if (semSel) semSel.addEventListener('change', function () { refreshDepends('semester'); });
  if (deptSel) deptSel.addEventListener('change', function () { refreshDepends('department'); });
  if (batchSel) batchSel.addEventListener('change', function () { refreshDepends('batch'); });
  if (sessionSel) sessionSel.addEventListener('change', function () { refreshDepends('session'); });
  if (subjectSel) subjectSel.addEventListener('change', function () { refreshDepends('subject'); });
  if (modeSel) modeSel.addEventListener('change', function () { updateModeBadge(modeSel.value); loadFailed(); });

  // Sortable/searchable results table (presentation only).
  if (window.AnalyticsTable) {
    window.AnalyticsTable.enhance('failed-table', {
      search: 'failed-search',
      count: 'failed-count',
      rowLabel: 'records'
    });
  }

  refreshDepends('all');
  updateModeBadge('original');
  loadFailed();
})();

