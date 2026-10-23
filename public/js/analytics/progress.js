(function () {
  'use strict';
  const form = document.getElementById('progress-filters');
  const batch = document.getElementById('progress-batch'), scope = document.getElementById('progress-scope'), mode = document.getElementById('progress-mode');
  const initial = new URLSearchParams(location.search);
  let version = 0, firstRequest = true;
  const el = key => document.getElementById('progress-' + key);
  const categories = ['withoutBacklog', 'withBacklog', 'uncleared', 'unknown'];
  const labels = ['Cleared Without Backlog', 'Cleared With Backlog', 'Currently Uncleared', 'Unknown / Insufficient Evidence'];
  const number = value => value == null ? '-' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  async function json(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || data.success === false) throw new Error(data.message || 'Unable to load academic progress.');
    return data;
  }
  function table(id, rows, empty) {
    const body = el(id); body.replaceChildren();
    if (!rows.length) {
      const td = document.createElement('td'), tr = document.createElement('tr'); td.colSpan = 7; td.textContent = empty; td.className = 'analytics-table-empty'; tr.append(td); body.append(tr); return;
    }
    rows.forEach(values => {
      const tr = document.createElement('tr');
      values.forEach(value => { const td = document.createElement('td'); if (value instanceof Node) td.append(value); else td.textContent = value == null ? '-' : String(value); tr.append(td); });
      body.append(tr);
    });
  }
  function clear() {
    el('summary-heading').textContent = 'Loading selected analysis scope...';
    el('status-heading').textContent = 'Completion Status';
    el('scope-description').textContent = '';
    ['total', ...categories, 'clearanceRate'].forEach(key => { el(key).textContent = '-'; });
    ['status', 'trend'].forEach(key => { AnalyticsCharts.destroy('progress-' + key + '-chart'); el(key + '-chart').textContent = ''; el(key + '-description').textContent = ''; });
    table('courses-body', [], 'Loading course history...'); table('attention-body', [], 'Loading student history...');
    el('attention-note').textContent = '';
  }
  async function load(resetScope) {
    const request = ++version;
    clear(); el('state').textContent = 'Loading academic progress...'; form.setAttribute('aria-busy', 'true');
    const query = new URLSearchParams({ batch_id: batch.value, mode: mode.value });
    const selected = resetScope ? '' : scope.value;
    if (selected) query.set('analysis_scope', selected);
    if (firstRequest && !resetScope) {
      ['analysis_scope', 'semester', 'academic_year'].forEach(key => { if (initial.has(key)) query.set(key, initial.get(key)); });
    }
    firstRequest = false;
    if (resetScope) { scope.replaceChildren(); scope.disabled = true; }
    try {
      const data = await json('/analytics/api/progress?' + query);
      if (request !== version) return;
      scope.replaceChildren();
      const semesterGroup = document.createElement('optgroup'), yearGroup = document.createElement('optgroup');
      semesterGroup.label = 'Semesters'; yearGroup.label = 'Study Years';
      data.semesters.forEach(term => semesterGroup.append(new Option('Semester ' + term, 'semester:' + term)));
      data.years.forEach(year => yearGroup.append(new Option(year.label, 'year:' + year.year)));
      if (data.semesters.length) scope.append(semesterGroup);
      if (data.years.length) scope.append(yearGroup);
      scope.value = data.filters.analysis_scope || '';
      scope.disabled = !data.semesters.length;
      const canonical = new URLSearchParams({ batch_id: data.filters.batch_id, mode: data.mode });
      if (data.filters.analysis_scope) canonical.set('analysis_scope', data.filters.analysis_scope);
      history.replaceState(history.state, '', location.pathname + '?' + canonical + location.hash);
      ['total', ...categories, 'clearanceRate'].forEach(key => { el(key).textContent = number(data.summary[key]) + (key === 'clearanceRate' && data.summary[key] != null ? '%' : ''); });
      el('summary-heading').textContent = data.label + ' Completion';
      el('scope-description').textContent = data.description;
      el('status-heading').textContent = data.label + ' Completion Status';
      el('status-chart').setAttribute('aria-label', data.label + ' Completion Status');
      el('clearance-heading').textContent = 'Clearance Status (' + (data.mode === 'effective' ? 'Effective' : 'Original') + ')';
      el('state').textContent = data.summary.total ? `${data.summary.unknown} students have insufficient verified history for ${data.label}.` : 'No students found for the selected batch.';
      el('report-link').href = '/reports/student-progress?' + new URLSearchParams({ batch_id: data.filters.batch_id, mode: data.mode });
      AnalyticsCharts.render('progress-status-chart', { type: 'bar', scroll: false, labels: data.summary.total ? labels : [], datasets: [{ label: 'Students', data: categories.map(key => data.summary[key]) }], decimals: 0, legend: false, emptyMessage: 'No students found for this selection.' });
      AnalyticsCharts.render('progress-trend-chart', { type: 'bar', stacked: true, labels: data.trends.map(t => t.label), datasets: categories.map((key, i) => ({ label: labels[i], data: data.trends.map(t => t[key]) })), decimals: 0, emptyMessage: 'No recorded semester history is available.' });
      el('status-description').textContent = labels.map((label, i) => label + ': ' + data.summary[categories[i]]).join('; ');
      el('trend-description').textContent = 'Each bar includes its own recorded participants, through the end of the selected scope. Future semesters without participation are omitted. ' + data.trends.map(t => t.label + ': ' + categories.map((key, i) => labels[i] + ' ' + t[key]).join(', ')).join('; ');
      table('courses-body', data.courses.map(c => [c.semester, c.code, c.name, c.backlog, c.cleared, c.uncleared, number(c.clearanceRate) + '%']), 'No verified backlog history is available for this selection.');
      table('attention-body', data.attention.map(s => {
        const link = document.createElement('a');
        link.className = 'btn btn-sm btn-outline-primary analytics-report-action';
        link.setAttribute('aria-label', 'View student result for ' + s.usn);
        const icon = document.createElement('span'); icon.className = 'material-icons'; icon.textContent = 'description'; icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.textContent = 'Student Result';
        link.append(icon, label);
        link.href = '/reports/student?' + new URLSearchParams({ batch_id: data.filters.batch_id, student_id: s.studentId, mode: data.mode });
        return [s.usn, s.name, s.period, s.unclearedCourses, s.latestAttempt, 'Uncleared', link];
      }), 'No students currently have known uncleared courses.');
      el('attention-note').textContent = `${data.mode === 'effective' ? 'Effective results, including approved effective revaluation' : 'Original results, before revaluation'}. Showing ${data.attention.length} of ${data.attentionTotal} students with known uncleared work.`;
    } catch (error) {
      if (request !== version) return;
      el('state').textContent = error.message;
      table('courses-body', [], 'Unable to load course history.'); table('attention-body', [], 'Unable to load student history.');
    } finally { if (request === version) form.setAttribute('aria-busy', 'false'); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  batch.addEventListener('change', () => load(true));
  mode.addEventListener('change', () => load());
  scope.addEventListener('change', () => load());
  form.addEventListener('reset', () => setTimeout(() => { mode.value = 'effective'; load(true); }, 0));
  async function init() {
    try {
      const result = await json('/analytics/api/filter-options/batches');
      result.data.forEach(row => batch.add(new Option(row.batchName, row.batchId)));
      if ([...batch.options].some(o => o.value === initial.get('batch_id'))) batch.value = initial.get('batch_id');
      mode.value = initial.get('mode') === 'original' ? 'original' : 'effective';
      const selected = initial.get('analysis_scope') || (initial.get('academic_year') ? 'year:' + initial.get('academic_year') : initial.get('semester') ? 'semester:' + initial.get('semester') : '');
      if (selected) scope.add(new Option('', selected));
      await load();
    } catch (error) { el('state').textContent = 'Unable to load batch filters. Please reload to retry.'; }
  }
  init();
})();
