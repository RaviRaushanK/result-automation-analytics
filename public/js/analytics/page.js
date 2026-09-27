/** Shared browser helpers for the Phase 5 analytics pages. */
(function () {
  'use strict';
  window.AnalyticsPage = function (config) {
    var form = document.getElementById('analytics-filter-form');
    if (!form) return;
    var request = 0, filterRequest = 0, offset = 0, limit = 25, charts = [];
    // Selects that must NOT offer an empty/"All" choice. Their options are
    // listed newest-first by the API, so the first option is the latest value
    // and becomes the default when nothing else is selected.
    var firstOption = config.firstOption || ['batch_id'];
    var body = document.getElementById(config.page + '-table-body');
    var prev = document.getElementById(config.page + '-page-prev');
    var next = document.getElementById(config.page + '-page-next');
    function text(value) { return value == null ? '\u2014' : String(value); }
    function number(value, digits) {
      return value == null || value === '' || !Number.isFinite(Number(value)) ? '\u2014' :
        Number(value).toLocaleString(undefined, { maximumFractionDigits: digits == null ? 2 : digits });
    }
    function filters() {
      var params = new URLSearchParams();
      Array.from(form.elements).forEach(function (el) {
        if (el.name && !el.disabled && el.value !== '') params.set(el.name, el.value.trim());
      });
      return params;
    }
    async function json(url) {
      var response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Request failed: ' + response.status);
      var result = await response.json();
      if (result.success === false) throw new Error(result.message || 'API error');
      return result;
    }
    function row(values) {
      var tr = document.createElement('tr');
      values.forEach(function (value) {
        var td = document.createElement('td');
        // Node values (e.g. statusBadge spans) are appended as-is; scalars stay
        // on textContent so cell text is never interpreted as HTML.
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = text(value);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    // Dashboard-style status badge (dashboard.css .badge-status + .badge-pass/.badge-fail).
    // Values mirror the Result.result_status ENUM('pass','fail'); anything else
    // falls back to the neutral .badge-status look and an em dash for empty.
    function statusBadge(value) {
      var raw = value == null ? '' : String(value);
      var lower = raw.toLowerCase();
      var span = document.createElement('span');
      var cls = 'badge-status';
      if (lower === 'pass') cls += ' badge-pass';
      else if (lower === 'fail') cls += ' badge-fail';
      span.className = cls;
      span.textContent = raw || '\u2014';
      return span;
    }
    function message(value) {
      body.textContent = '';
      var tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = config.columns; td.className = 'analytics-table-empty'; td.textContent = value;
      tr.appendChild(td); body.appendChild(tr);
    }
    function clearCharts() {
      charts.forEach(function (chart) { chart.destroy(); }); charts = [];
      (config.charts || []).forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        // Unwrap the scroll scaffold added by chart(), restoring the plain host.
        var scroller = el.parentNode;
        if (scroller && scroller.classList && scroller.classList.contains('analytics-chart-scroll')) {
          scroller.parentNode.insertBefore(el, scroller);
          scroller.parentNode.removeChild(scroller);
        }
        el.style.width = ''; el.style.minWidth = '';
        el.textContent = '';
      });
    }
    function chart(id, labels, datasets) {
      var target = document.getElementById(id);
      if (!labels.length) { target.textContent = 'No chart data found.'; return; }
      if (typeof Chart === 'undefined') { target.textContent = 'Chart unavailable. See the table for values.'; return; }
      // One fixed slot per category so bars never squeeze or overlap when the
      // session list grows; the .analytics-chart-scroll wrapper (analytics.css)
      // scrolls left/right once the strip exceeds the card width.
      // The host keeps width:100% so a chart with few sessions still fills its
      // whole card; min-width only kicks in to grow the strip past the card.
      var perBar = 88;
      var stripWidth = Math.max(labels.length * perBar, 0);
      var host = target;
      var parent = target.parentNode;
      var scroller = null;
      if (parent && parent.classList && parent.classList.contains('analytics-chart-scroll')) {
        scroller = parent;
      } else {
        scroller = document.createElement('div');
        scroller.className = 'analytics-chart-scroll';
        parent.insertBefore(scroller, target);
        scroller.appendChild(target);
      }
      host.style.minWidth = stripWidth + 'px';
      host.style.width = '100%';
      var canvas = document.createElement('canvas'); target.appendChild(canvas);
      charts.push(new Chart(canvas, { type: 'bar', data: { labels: labels, datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } }));
    }
    async function load() {
      var current = ++request;
      clearCharts(); message('Loading analytics…');
      body.setAttribute('aria-busy', 'true');
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      if (config.clear) config.clear();
      var params = filters();
      if (prev) { params.set('limit', limit); params.set('offset', offset); }
      try {
        var result = await json('/analytics/api/' + config.page + '?' + params);
        if (current !== request) return;
        body.textContent = '';
        var rows = config.render(result, { row: row, number: number, chart: chart, statusBadge: statusBadge });
        if (config.done) config.done(result, { row: row, number: number, chart: chart, statusBadge: statusBadge, params: params });
        if (!rows) message('No analytics data found for the selected filters.');
        var label = document.getElementById('analytics-mode-label');
        if (label) label.textContent = result.mode === 'effective' ? 'Effective' : 'Original';
        var badge = document.getElementById('analytics-mode-badge');
        if (badge) {
          badge.classList.toggle('is-effective', result.mode === 'effective');
          badge.classList.toggle('is-original', result.mode !== 'effective');
        }
        if (prev) prev.disabled = offset === 0;
        if (next) next.disabled = rows < limit;
        var indicator = document.getElementById(config.page + '-page-indicator');
        if (indicator) indicator.textContent = 'Page ' + (offset / limit + 1);
      } catch (err) {
        if (current !== request) return;
        clearCharts(); message('Unable to load analytics data. Please try again.');
      } finally { if (current === request) body.setAttribute('aria-busy', 'false'); }
    }
    var definitions = [
      ['semesters', 'semester', 'semester', 'semester'],
      ['batches', 'batch_id', 'batchId', 'batchName'],
      ['sessions', 'session_id', 'sessionId', 'examSession'],
      ['subjects', 'subject_id', 'subjectId', 'subjectCode']
    ];
    async function refresh(changed) {
      var current = ++filterRequest;
      var children = { semester: ['session_id', 'subject_id'],
        batch_id: ['session_id', 'subject_id'], session_id: ['subject_id'] };
      (children[changed] || []).forEach(function (name) { if (form.elements.namedItem(name)) form.elements.namedItem(name).value = ''; });
      var params = filters();
      await Promise.all(definitions.map(async function (def) {
        var el = form.elements.namedItem(def[1]);
        if (!el) return;
        var scoped = new URLSearchParams(params); scoped.delete(def[1]); scoped.delete('usn');
        (children[def[1]] || []).forEach(function (key) { scoped.delete(key); });
        try {
          var result = await json('/analytics/api/filter-options/' + def[0] + '?' + scoped);
          if (current !== filterRequest) return;
          var selected = el.value, seen = new Set();
          var first = firstOption.indexOf(def[1]) !== -1;
          while (el.options.length > (first ? 0 : 1)) el.remove(first ? 0 : 1);
          (result.data || []).forEach(function (item) {
            var value = String(item[def[2]]);
            if (seen.has(value)) return;
            seen.add(value);
            var option = document.createElement('option'); option.value = value;
            option.textContent = text(item[def[3]]); el.appendChild(option);
          });
          el.value = seen.has(selected) ? selected
            : (first && el.options.length ? el.options[0].value : '');
        } catch (err) { el.title = 'Unable to refresh options. Apply filters to retry analytics.'; }
      }));
    }
    form.addEventListener('submit', function (event) { event.preventDefault(); offset = 0; load(); });
    form.addEventListener('reset', function () { setTimeout(function () { offset = 0; refresh(); load(); }, 0); });
    form.addEventListener('change', function (event) {
      refresh(event.target.name);
      if (event.target.name === 'mode' || event.target.name === 'attempt') { offset = 0; load(); }
    });
    if (prev) prev.addEventListener('click', function () { if (offset > 0) { offset -= limit; load(); } });
    if (next) next.addEventListener('click', function () { offset += limit; load(); });
    // Populate the option lists first: the default Batch comes from the
    // API ordering, so the first request must wait for those options.
    refresh().then(load, load);
  };
})();
