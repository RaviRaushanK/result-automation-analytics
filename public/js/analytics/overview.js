/**
 * SRAAS - Analytics Overview (Phase 5)
 * Connects the Overview EJS shell to the Analytics API.
 * Chart.js 4.4.1 loaded via EJS view.
 */
(function () {
  'use strict';

  // ---------- DOM refs ----------
  const form = document.getElementById('analytics-filter-form');
  const modeBadge = document.getElementById('analytics-mode-badge');
  const modeLabel = document.getElementById('analytics-mode-label');

  const yearSel = document.getElementById('filter-academic-year');
  const semSel = document.getElementById('filter-semester');
  const examSessionSel = document.getElementById('filter-exam-session');
  const deptSel = document.getElementById('filter-department');
  const batchSel = document.getElementById('filter-batch');
  const sessionSel = document.getElementById('filter-session');
  const attemptSel = document.getElementById('filter-attempt');
  const modeSel = document.getElementById('filter-mode');

  const emptyState = document.getElementById('analytics-empty-state');

  // Summary cards: subject-level
  const cardStudents = document.querySelector('[data-metric="students"] .stat-value');
  const cardResults = document.querySelector('[data-metric="results"] .stat-value');
  const cardSubjAtt = document.querySelector('[data-metric="subjects-attempted"] .stat-value');
  const cardPassed = document.querySelector('[data-metric="passed"] .stat-value');
  const cardFailed = document.querySelector('[data-metric="failed"] .stat-value');
  const cardAvgMarks = document.querySelector('[data-metric="avg-marks"] .stat-value');

  // Summary cards: stored parent-result metrics
  const cardResultPass = document.querySelector('[data-metric="result-pass-count"] .stat-value');
  const cardResultFail = document.querySelector('[data-metric="result-fail-count"] .stat-value');
  const cardAvgSgpa = document.querySelector('[data-metric="avg-sgpa"] .stat-value');
  const cardAvgCgpa = document.querySelector('[data-metric="avg-cgpa"] .stat-value');

  const gradeDistChartEl = document.getElementById('grade-distribution-chart');
  const perfSummaryChartEl = document.getElementById('performance-summary-chart');

  // ---------- Helpers ----------
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>\"']/g, function (c) {
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

  function chartColors(n) {
    var dark = getTheme() === 'dark';
    var bg = dark
      ? ['rgba(96,165,250,0.7)', 'rgba(74,222,128,0.7)', 'rgba(251,191,36,0.7)', 'rgba(248,113,113,0.7)',
         'rgba(167,139,250,0.7)', 'rgba(34,211,238,0.7)', 'rgba(251,146,60,0.7)', 'rgba(52,211,153,0.7)']
      : ['rgba(37,99,235,0.7)', 'rgba(22,163,74,0.7)', 'rgba(217,119,6,0.7)', 'rgba(220,38,38,0.7)',
         'rgba(124,58,237,0.7)', 'rgba(8,145,178,0.7)', 'rgba(234,88,12,0.7)', 'rgba(5,150,105,0.7)'];
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({ bg: bg[i % bg.length], border: bg[i % bg.length].replace('0.7', '1') });
    }
    return out;
  }

  function destroyChart(c) {
    if (c) { try { c.destroy(); } catch (e) {} }
    return null;
  }

  function showSkeleton(show) {
    var cards = [cardStudents, cardResults, cardSubjAtt, cardPassed, cardFailed, cardAvgMarks,
                 cardResultPass, cardResultFail, cardAvgSgpa, cardAvgCgpa];
    cards.forEach(function (c) { if (c) c.textContent = '—'; });
    if (emptyState) emptyState.classList.add('d-none');
    if (gradeDistChartEl) gradeDistChartEl.classList.add('d-none');
    if (perfSummaryChartEl) perfSummaryChartEl.classList.add('d-none');
  }

  function showEmpty(show) {
    if (!emptyState) return;
    emptyState.classList.toggle('d-none', !show);
    if (gradeDistChartEl) gradeDistChartEl.classList.toggle('d-none', show);
    if (perfSummaryChartEl) perfSummaryChartEl.classList.toggle('d-none', show);
  }

  function showPlaceholder(el, msg) {
    if (!el) return;
    el.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'analytics-chart-placeholder';
    p.textContent = msg || 'Chart will appear here';
    el.appendChild(p);
  }

  function updateModeBadge(mode) {
    if (!modeBadge || !modeLabel) return;
    modeBadge.classList.remove('is-original', 'is-effective');
    modeBadge.classList.add('is-' + mode);
    modeLabel.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  // ---------- Charts (Chart.js 4.4.1, loaded by the Overview view) ----------
  // Data comes only from the existing Analytics APIs: /analytics/api/overview
  // and /analytics/api/grade-distribution for the same filter set.
  var gradeDistChart = null;
  var perfSummaryChart = null;

  function destroyCharts() {
    // Never reuse a canvas: destroy any existing instance first.
    gradeDistChart = destroyChart(gradeDistChart);
    perfSummaryChart = destroyChart(perfSummaryChart);
  }

  // Reuse the existing analytics chart height token (no new theme values).
  function chartHostHeight(el) {
    var page = el && el.closest ? el.closest('.analytics-page') : null;
    var raw = page ? getComputedStyle(page).getPropertyValue('--analytics-chart-min-height') : '';
    var px = parseFloat(raw);
    return px > 0 ? Math.round(px) : 320;
  }

  function sizeChartHost(el) {
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.height = chartHostHeight(el) + 'px';
  }

  function chartTextTokens() {
    var dark = getTheme() === 'dark';
    return {
      text: textColor(),
      grid: dark ? 'rgba(148, 163, 184, 0.28)' : 'rgba(107, 114, 128, 0.18)'
    };
  }

  function baseChartOptions(title) {
    var tokens = chartTextTokens();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tokens.text } },
        title: { display: !!title, text: title || '', color: tokens.text }
      },
      scales: {
        x: { ticks: { color: tokens.text }, grid: { color: tokens.grid } },
        y: { beginAtZero: true, ticks: { color: tokens.text, precision: 0 }, grid: { color: tokens.grid } }
      }
    };
  }

  /**
   * Grade Distribution: counts exactly as returned by /analytics/api/grade-distribution
   * (including the service-labelled "Unknown" bucket for NULL grades). No bucket is
   * added, merged or removed.
   */
  function renderGradeDistribution(rows) {
    var host = gradeDistChartEl;
    if (!host) return;
    gradeDistChart = destroyChart(gradeDistChart);
    host.textContent = '';
    var buckets = (rows || []).filter(function (g) { return g && g.count != null; });
    var summary = (rows || []).map(function (g) {
      return g.grade + ': ' + fmtInt(g.count) + ' (' + fmt(g.percentage, 2) + '%)';
    }).join(' • ');
    if (typeof Chart === 'undefined' || !buckets.length) {
      showPlaceholder(host, summary || 'No grade data in this scope.');
      return;
    }
    var colors = chartColors(buckets.length);
    sizeChartHost(host);
    var canvas = document.createElement('canvas');
    host.appendChild(canvas);
    gradeDistChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: buckets.map(function (g) { return g.grade; }),
        datasets: [{
          label: 'Subject grades',
          data: buckets.map(function (g) { return Number(g.count) || 0; }),
          backgroundColor: colors.map(function (c) { return c.bg; }),
          borderColor: colors.map(function (c) { return c.border; }),
          borderWidth: 1
        }]
      },
      options: (function () {
        var options = baseChartOptions('');
        options.plugins.tooltip = {
          callbacks: {
            afterLabel: function (context) {
              var bucket = buckets[context.dataIndex] || {};
              return bucket.percentage == null ? '' : fmt(bucket.percentage, 2) + '%';
            }
          }
        };
        return options;
      })()
    });
  }

  /**
   * Performance Summary: pass/fail counts as returned by /analytics/api/overview —
   * mode-aware subject outcomes next to the stored result-header counts. No ranking,
   * scoring or performance policy is applied.
   */
  function renderPerformanceSummary(subject, parent, passRate) {
    var host = perfSummaryChartEl;
    if (!host) return;
    perfSummaryChart = destroyChart(perfSummaryChart);
    host.textContent = '';
    var labels = ['Subject results', 'Stored result headers'];
    var passed = [Number(subject.passed) || 0, Number(parent.resultPassCount) || 0];
    var failed = [Number(subject.failed) || 0, Number(parent.resultFailCount) || 0];
    var title = passRate == null ? '' : 'Subject pass rate: ' + fmt(passRate, 2) + '%';
    var hasData = passed.some(function (v) { return v > 0; }) || failed.some(function (v) { return v > 0; });
    if (typeof Chart === 'undefined' || !hasData) {
      showPlaceholder(host, title || 'No performance data in this scope.');
      return;
    }
    var colors = chartColors(4);
    var passColor = colors[1];
    var failColor = colors[3];
    sizeChartHost(host);
    var canvas = document.createElement('canvas');
    host.appendChild(canvas);
    perfSummaryChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Passed', data: passed, backgroundColor: passColor.bg, borderColor: passColor.border, borderWidth: 1 },
          { label: 'Failed', data: failed, backgroundColor: failColor.bg, borderColor: failColor.border, borderWidth: 1 }
        ]
      },
      options: baseChartOptions(title)
    });
  }

  // ---------- Read form filters ----------
  function readFilters() {
    var p = new URLSearchParams();
    var v = function (sel) { var s = sel.value.trim(); return s ? s : null; };
    var y = v(yearSel), s = v(semSel), es = v(examSessionSel), d = v(deptSel), b = v(batchSel), ss = v(sessionSel);
    var att = attemptSel.value.trim(), m = modeSel.value.trim();
    if (y) p.set('exam_year', y);
    if (s) p.set('semester', s);
    if (es) p.set('exam_session', es);
    if (d) p.set('department_id', d);
    if (b) p.set('batch_id', b);
    if (ss) p.set('session_id', ss);
    if (att && att !== 'latest') p.set('attempt', att);
    if (m) p.set('mode', m);
    return p;
  }

  function qs(p) { var s = p.toString(); return s ? '?' + s : ''; }

  // ---------- Filter options cache ----------
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

  // ---------- Populate select ----------
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

  async function fetchJSON(url) {
    var response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Analytics request failed (' + response.status + ')');
    return response.json();
  }

  var overviewRequest = 0;
  async function loadOverview() {
    var request = ++overviewRequest;
    showSkeleton(true);
    try {
      var params = readFilters();
      var responses = await Promise.all([
        fetchJSON('/analytics/api/overview' + qs(params)),
        // Grade Distribution chart consumes its own Analytics endpoint with the
        // same filter set; a failure there must not blank the whole page.
        fetchJSON('/analytics/api/grade-distribution' + qs(params)).catch(function (err) {
          console.error('Failed to load grade distribution', err);
          return null;
        })
      ]);
      if (request !== overviewRequest) return;
      var json = responses[0];
      var grades = responses[1] ? (responses[1].data || []) : [];
      var subject = json.subject || {};
      var parent = json.parent || {};
      var subjectAttempted = Number(subject.subjectsAttempted);
      // Presentation fallback: the summary payload returns `subjectsAttempted`
      // (the service derives passPercentage from `attempted`), so compute the
      // displayed rate locally when the service did not supply one.
      var subjectPassRate = subject.passPercentage != null ? subject.passPercentage
        : (subjectAttempted > 0 ? (Number(subject.passed) / subjectAttempted) * 100 : null);
      [
        [cardStudents, subject.students, 0], [cardResults, subject.results, 0],
        [cardSubjAtt, subject.subjectsAttempted, 0], [cardPassed, subject.passed, 0],
        [cardFailed, subject.failed, 0], [cardAvgMarks, subject.avgMarks, 2],
        [cardResultPass, parent.resultPassCount, 0], [cardResultFail, parent.resultFailCount, 0],
        [cardAvgSgpa, parent.avgSgpa, 2], [cardAvgCgpa, parent.avgCgpa, 2]
      ].forEach(function (entry) {
        if (!entry[0]) return;
        entry[0].textContent = fmt(entry[1], entry[2]);
        entry[0].removeAttribute('aria-hidden');
        entry[0].classList.remove('analytics-value-placeholder');
      });
      updateModeBadge(json.mode === 'effective' ? 'effective' : 'original');
      showEmpty(!subjectAttempted && !Number(parent.resultTotal));
      renderGradeDistribution(grades);
      renderPerformanceSummary(subject, parent, subjectPassRate);
    } catch (err) {
      if (request !== overviewRequest) return;
      showEmpty(false);
      destroyCharts();
      showPlaceholder(gradeDistChartEl, 'Unable to load analytics. Please try again.');
      showPlaceholder(perfSummaryChartEl, '');
      console.error('Failed to load overview', err);
    }
  }

  var filterRequest = 0;
  async function refreshDepends(changed) {
    var request = ++filterRequest;
    var definitions = [
      ['years', yearSel, 'examYear', 'examYear', 'exam_year'],
      ['semesters', semSel, 'semester', 'semester', 'semester'],
      ['departments', deptSel, 'departmentId', 'name', 'department_id'],
      ['batches', batchSel, 'batchId', 'batchName', 'batch_id'],
      ['sessions', sessionSel, 'sessionId', 'examSession', 'session_id']
    ];
    if (changed !== 'all' && changed !== 'session') sessionSel.value = '';
    if (changed === 'department') batchSel.value = '';
    var params = readFilters();
    await Promise.all(definitions.map(async function (definition) {
      var scoped = new URLSearchParams(params);
      scoped.delete(definition[4]);
      if (definition[0] !== 'sessions') scoped.delete('session_id');
      if (definition[0] === 'departments') scoped.delete('batch_id');
      var rows = await loadFilterOptions(definition[0], scoped);
      if (request === filterRequest) populateSelect(definition[1], rows, definition[2], definition[3], 'All');
    }));
  }


  // ---------- Events ----------
  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); loadOverview(); });
    form.addEventListener('reset', function () {
      yearSel.value = ''; semSel.value = ''; examSessionSel.value = '';
      deptSel.value = ''; batchSel.value = ''; sessionSel.value = '';
      attemptSel.value = 'latest'; modeSel.value = 'original';
      updateModeBadge('original');
    });
  }
  if (yearSel) yearSel.addEventListener('change', function () { refreshDepends('exam_year'); });
  if (semSel) semSel.addEventListener('change', function () { refreshDepends('semester'); });
  if (deptSel) deptSel.addEventListener('change', function () { refreshDepends('department'); });
  if (batchSel) batchSel.addEventListener('change', function () { refreshDepends('batch'); });
  if (sessionSel) sessionSel.addEventListener('change', function () { refreshDepends('session'); });
  if (examSessionSel) examSessionSel.addEventListener('change', function () { refreshDepends('session'); });
  if (modeSel) modeSel.addEventListener('change', function () { updateModeBadge(modeSel.value); loadOverview(); });

  // ---------- Init ----------
  refreshDepends('all');
  updateModeBadge('original');
  loadOverview();
})();
