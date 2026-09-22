/**
 * SRAAS - Analytics Toppers (Phase 5)
 * Connects the Toppers EJS shell to /analytics/api/toppers.
 * No ranking policy is invented; the API returns candidates as provided.
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
  const attemptSel = document.getElementById('filter-attempt');
  const modeSel = document.getElementById('filter-mode');
  const emptyState = document.getElementById('analytics-empty-state');
  const tableBody = document.getElementById('toppers-table-body');
  const prevBtn = document.getElementById('toppers-page-prev');
  const nextBtn = document.getElementById('toppers-page-next');
  const pageIndicator = document.getElementById('toppers-page-indicator');
  // Pagination cursor for the backend limit/offset contract.
  const PAGE_SIZE = 25;
  let currentPage = 0;

  // ---------- Helpers ----------
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function fmt(n, d) {
    if (n == null || n === '' || isNaN(n)) return '—';
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
      if (tableBody) {
        tableBody.innerHTML = '';
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '8');
        td.className = 'analytics-table-empty';
        td.textContent = 'Loading…';
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
    var att = attemptSel.value.trim(), m = modeSel.value.trim();
    if (y) p.set('exam_year', y);
    if (s) p.set('semester', s);
    if (d) p.set('department_id', d);
    if (b) p.set('batch_id', b);
    if (ss) p.set('session_id', ss);
    if (att && att !== 'latest') p.set('attempt', att);
    if (m) p.set('mode', m);
    return p;
  }

  function qs(p) { var s = p.toString(); return s ? '?' + s : ''; }

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

  // Dependent filter options: scoped by the current filters, minus the option's
  // own parameter (and its dependants) so a selected value stays selectable.
  function refreshDepends(changed) {
    var children = {
      exam_year: ['semester', 'department_id', 'batch_id', 'session_id'],
      department_id: ['batch_id', 'session_id'],
      batch_id: ['session_id']
    };
    (children[changed] || []).forEach(function (name) {
      if (form && form.elements.namedItem(name)) form.elements.namedItem(name).value = '';
    });
    var params = readFilters();
    var definitions = [
      ['years', yearSel, 'examYear', 'examYear', 'exam_year', 'All Academic Years'],
      ['semesters', semSel, 'semester', 'semester', 'semester', 'All Semesters'],
      ['departments', deptSel, 'departmentId', 'name', 'department_id', 'All Departments'],
      ['batches', batchSel, 'batchId', 'batchName', 'batch_id', 'All Batches'],
      ['sessions', sessionSel, 'sessionId', 'examSession', 'session_id', 'All Sessions']
    ];
    definitions.forEach(function (definition) {
      var scoped = new URLSearchParams(params);
      scoped.delete(definition[4]);
      (children[definition[4]] || []).forEach(function (name) { scoped.delete(name); });
      loadFilterOptions(definition[0], scoped).then(function (items) {
        populateSelect(definition[1], items, definition[2], definition[3], definition[5]);
      });
    });
  }

  function statusBadge(status) {
    var cls = 'analytics-status';
    var icon = 'help_outline';
    if (status === 'pass') { cls += ' pass'; icon = 'check_circle'; }
    else if (status === 'fail') { cls += ' fail'; icon = 'cancel'; }
    else { cls += ' neutral'; icon = 'help_outline'; }
    return '<span class="' + cls + '"><span class="material-icons" aria-hidden="true">' + icon + '</span> ' +
      esc(status ? status.toUpperCase() : '—') + '</span>';
  }


  function refreshTable() {
    if (window.AnalyticsTable) window.AnalyticsTable.refresh('toppers-table');
  }

  function updatePagination(rowCount) {
    if (pageIndicator) pageIndicator.textContent = 'Page ' + (currentPage + 1);
    if (prevBtn) prevBtn.disabled = currentPage === 0;
    if (nextBtn) nextBtn.disabled = rowCount < PAGE_SIZE;
  }

  function renderRow(row) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (row.rank != null ? esc(row.rank) : '—') + '</td>' +
      '<td>' + esc(row.usn) + '</td>' +
      '<td>' + esc(row.studentName) + '</td>' +
      '<td>' + esc(row.semester) + '</td>' +
      '<td>' + (row.attemptNo != null ? esc(row.attemptNo) : '—') + '</td>' +
      '<td>' + (row.sgpa != null ? fmt(row.sgpa, 2) : '—') + '</td>' +
      '<td>' + (row.cgpa != null ? fmt(row.cgpa, 2) : '—') + '</td>' +
      '<td>' + statusBadge(row.parentStatus || row.resultStatus) + '</td>';
    return tr;
  }

  function loadToppers(resetPage) {
    if (resetPage) currentPage = 0;
    showSkeleton(true);
    showEmpty(false);
    var params = readFilters();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(currentPage * PAGE_SIZE));
    var url = '/analytics/api/toppers' + qs(params);
    fetchJSON(url).then(function (json) {
      if (json.success === false) throw new Error(json.message || 'API error');
      updateModeBadge((json.filters && json.filters.mode) || 'original');
      var data = json.data || [];
      if (!tableBody) return;
      tableBody.innerHTML = '';
      if (!data.length) {
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '8');
        td.className = 'analytics-table-empty';
        td.textContent = 'No candidate data found for the selected filters.';
        tr.appendChild(td);
        tableBody.appendChild(tr);
        showEmpty(true);
        refreshTable();
        updatePagination(0);
        return;
      }
      data.forEach(function (row) { tableBody.appendChild(renderRow(row)); });
      showEmpty(false);
      refreshTable();
      updatePagination(data.length);
    }).catch(function (err) {
      console.error('Toppers load error:', err);
      if (tableBody) {
        tableBody.innerHTML = '';
        var tr = document.createElement('tr');
        tr.className = 'analytics-table-empty-row';
        var td = document.createElement('td');
        td.setAttribute('colspan', '8');
        td.className = 'analytics-table-empty';
        td.textContent = 'Unable to load analytics data. Please try again.';
        tr.appendChild(td);
        tableBody.appendChild(tr);
      }
      showEmpty(true);
      refreshTable();
      updatePagination(0);
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); loadToppers(true); });
    form.addEventListener('reset', function () {
      yearSel.value = ''; semSel.value = ''; deptSel.value = ''; batchSel.value = ''; sessionSel.value = '';
      attemptSel.value = 'latest'; modeSel.value = 'original';
      updateModeBadge('original');
    });
  }
  if (yearSel) yearSel.addEventListener('change', function () { refreshDepends('exam_year'); });
  if (semSel) semSel.addEventListener('change', function () { refreshDepends('semester'); });
  if (deptSel) deptSel.addEventListener('change', function () { refreshDepends('department'); });
  if (batchSel) batchSel.addEventListener('change', function () { refreshDepends('batch'); });
  if (sessionSel) sessionSel.addEventListener('change', function () { refreshDepends('session'); });
  if (modeSel) modeSel.addEventListener('change', function () { updateModeBadge(modeSel.value); loadToppers(true); });

  // Pagination + sortable/searchable table (presentation only).
  if (prevBtn) prevBtn.addEventListener('click', function () {
    if (currentPage > 0) { currentPage--; loadToppers(false); }
  });
  if (nextBtn) nextBtn.addEventListener('click', function () {
    currentPage++;
    loadToppers(false);
  });
  if (window.AnalyticsTable) {
    window.AnalyticsTable.enhance('toppers-table', {
      search: 'toppers-search',
      count: 'toppers-count',
      rowLabel: 'candidates'
    });
  }

  refreshDepends('all');
  updateModeBadge('original');
  loadToppers(true);
})();
