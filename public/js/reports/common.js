'use strict';

(() => {
  const root = document.getElementById('reports-page');
  if (!root) return;
  const type = root.dataset.reportType;
  const form = document.getElementById('reports-filters');
  const el = name => document.getElementById(`report-${name}`);
  const ui = name => document.getElementById(`reports-${name}`);
  const required = ['batch_id', ...(type === 'student' ? ['student_id'] : []), 'semester', 'session_id', ...(type === 'student' ? ['attempt_no'] : []), ...(type === 'subject' ? ['subject_id'] : [])];
  const dependent = ['batch_id', ...(type === 'student' ? ['student_id'] : []), 'semester', 'session_id', ...(type === 'student' ? ['attempt_no'] : []), ...(['subject', 'revaluation'].includes(type) ? ['subject_id'] : [])];
  let version = 0;
  let cascadeAbort;
  let reportAbort;
  let cascading = false;
  let cascadeName;
  let generating = false;
  let currentPage = 1;
  let totalPages = 0;
  let generatedQuery;

  function ready() {
    ui('generate').disabled = cascading || generating || required.some(name => !el(name).value || el(name).disabled);
  }

  function message(error) {
    ui('error').textContent = error || '';
    ui('error').hidden = !error;
  }

  function invalidate() {
    version++;
    reportAbort?.abort();
    generating = false;
    generatedQuery = undefined;
    ui('output').hidden = true;
    ui('loading').hidden = true;
    ui('empty').hidden = false;
    ui('empty').textContent = 'Select the required filters and generate the report.';
    message('');
  }

  function placeholder(name) {
    const select = el(name);
    return type === 'revaluation' && name === 'subject_id' ? 'All Subjects' : `Select ${select.labels[0].textContent}`;
  }

  function resetSelect(name) {
    const select = el(name);
    if (!select) return;
    select.replaceChildren(new Option(placeholder(name), ''));
    select.disabled = true;
  }

  async function fetchJSON(path, signal) {
    const response = await fetch(`/reports/${path}`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.message || body.error || 'Unable to load report data.');
    return body;
  }

  async function load(name, path, key, label, signal, expectedVersion) {
    const select = el(name);
    select.disabled = true;
    select.replaceChildren(new Option('Loading...', ''));
    const { options } = await fetchJSON(path, signal);
    if (expectedVersion !== version) return;
    select.replaceChildren(new Option(options.length ? placeholder(name) : `No ${name === 'attempt_no' ? 'results' : select.labels[0].textContent.toLowerCase()} available`, ''));
    options.forEach(row => select.add(new Option(label(row), String(row[key]))));
    select.disabled = !options.length;
    if (name === 'attempt_no' && options.length === 1) select.value = String(options[0][key]);
    ui('filter-state').textContent = options.length ? '' : select.options[0].textContent;
  }

  async function cascade(name) {
    cascadeName = name;
    cascadeAbort?.abort();
    cascadeAbort = new AbortController();
    const signal = cascadeAbort.signal;
    const expectedVersion = version;
    cascading = true;
    ready();
    ui('filter-state').textContent = 'Loading filters...';
    const batch = el('batch_id').value;
    const query = new URLSearchParams({ batch_id: batch });
    try {
      if (name === 'initial') await load('batch_id', 'api/batches', 'batch_id', row => `${row.batch_name} (${row.start_year}-${row.end_year})`, signal, expectedVersion);
      else if (!batch) ui('filter-state').textContent = '';
      else if (name === 'batch_id' && type === 'student') await load('student_id', `api/batches/${batch}/students`, 'student_id', row => `${row.usn} - ${row.student_name}`, signal, expectedVersion);
      else if (name === 'batch_id' || name === 'student_id') {
        if (type !== 'student' || el('student_id').value) await load('semester', `api/batches/${batch}/semesters`, 'semester', row => row.semester, signal, expectedVersion);
        else ui('filter-state').textContent = '';
      } else if (name === 'semester' && el('semester').value) {
        query.set('semester', el('semester').value);
        await load('session_id', `api/sessions?${query}`, 'session_id', row => `${row.exam_session} ${row.exam_year} - Semester ${row.semester}`, signal, expectedVersion);
      } else if (name === 'session_id' && el('session_id').value) {
        query.set('session_id', el('session_id').value);
        if (type === 'student') {
          query.set('student_id', el('student_id').value);
          await load('attempt_no', `api/student-results?${query}`, 'attempt_no', row => `Attempt ${row.attempt_no} - ${row.exam_type}`, signal, expectedVersion);
        } else if (type === 'subject' || type === 'revaluation') {
          await load('subject_id', `api/subjects?${query}`, 'subject_id', row => `${row.subject_code} - ${row.subject_name}`, signal, expectedVersion);
        } else ui('filter-state').textContent = '';
      } else ui('filter-state').textContent = '';
    } catch (err) {
      if (err.name !== 'AbortError' && expectedVersion === version) {
        message(err.message);
        ui('filter-state').textContent = 'Unable to load filters.';
        // Clear Loading... placeholders after a failed dependent request.
        dependent.filter(key => el(key).options[0]?.textContent === 'Loading...').forEach(resetSelect);
      }
    } finally {
      if (expectedVersion === version) { cascading = false; ready(); }
    }
  }

  function display(key, value) {
    if (value === null || value === undefined || value === '') return '-';
    if (key === 'revaluated' || key === 'is_effective') return Number(value) ? 'Yes' : 'No';
    if (key.endsWith('status')) return String(value).toUpperCase();
    if (key === 'reviewed_at') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
    }
    return String(value);
  }

  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }

  function render(report) {
    const head = ui('table').querySelector('thead');
    const body = ui('table').querySelector('tbody');
    const header = node('tr');
    ['Sl. No.', ...report.columns.map(column => column.label)].forEach(label => { const cell = node('th', label); cell.scope = 'col'; header.append(cell); });
    head.replaceChildren(header);
    const fragment = document.createDocumentFragment();
    report.rows.forEach((row, index) => {
      const tr = node('tr');
      tr.append(node('td', (report.pagination.page - 1) * report.pagination.pageSize + index + 1));
      report.columns.forEach(column => {
        const td = node('td');
        const text = display(column.key, row[column.key]);
        if (column.key.endsWith('status') && row[column.key]) td.append(node('span', text, `badge reports-status reports-status-${row[column.key]}`));
        else td.textContent = text;
        tr.append(td);
      });
      fragment.append(tr);
    });
    if (!report.rows.length) {
      const tr = node('tr');
      const td = node('td', { student: 'No subject results are stored for this attempt.', class: 'No result attempts match the selected filters.', subject: 'No subject result attempts match the selected filters.', revaluation: 'No persisted revaluation events match the selected filters.' }[type], 'reports-table-empty');
      td.colSpan = report.columns.length + 1;
      tr.append(td); fragment.append(tr);
    }
    body.replaceChildren(fragment);
    ui('summary').replaceChildren(...report.metrics.map(([label, value]) => {
      const metric = node('div'); metric.append(node('span', label), node('strong', display(label === 'Overall Result' ? 'result_status' : '', value))); return metric;
    }));
    ui('context').replaceChildren(...report.context.map(([label, value]) => {
      const pair = node('div'); pair.append(node('dt', label), node('dd', value)); return pair;
    }));
    currentPage = report.pagination.page;
    totalPages = report.pagination.totalPages;
    ui('page-info').textContent = totalPages ? `Page ${currentPage} of ${totalPages} / ${report.pagination.totalRows} rows` : '0 rows';
    ui('prev').disabled = currentPage <= 1;
    ui('next').disabled = currentPage >= totalPages;
    ui('pagination').hidden = type === 'student' || totalPages <= 1;
    ui('view').textContent = type === 'revaluation' ? 'Revaluation Events' : `${report.filters.mode === 'effective' ? 'Effective' : 'Original'} Result`;
    ui('output').hidden = false;
    ui('empty').hidden = true;
    ui('csv').href = `/reports/${type}/export.csv?${generatedQuery}`;
    ui('print').href = `/reports/${type}/print?${generatedQuery}`;
  }

  async function generate(page = 1) {
    if (required.some(name => !el(name).value || el(name).disabled)) return;
    reportAbort?.abort();
    reportAbort = new AbortController();
    const expectedVersion = version;
    const request = reportAbort;
    const query = new URLSearchParams(new FormData(form));
    query.set('page', String(page));
    generating = true;
    ready(); message('');
    ui('prev').disabled = true; ui('next').disabled = true;
    ui('output').hidden = true; ui('empty').hidden = true; ui('loading').hidden = false;
    try {
      const { report } = await fetchJSON(`api/${type}?${query}`, request.signal);
      if (expectedVersion !== version || request !== reportAbort) return;
      generatedQuery = query;
      render(report);
    } catch (err) {
      if (err.name !== 'AbortError' && expectedVersion === version && request === reportAbort) {
        message(err.message); ui('empty').hidden = false;
      }
    } finally {
      if (expectedVersion === version && request === reportAbort) { generating = false; ui('loading').hidden = true; ready(); }
    }
  }

  form.addEventListener('change', event => {
    const name = event.target.name;
    const pendingCascade = cascading ? cascadeName : undefined;
    invalidate();
    // Abort/reset downstream filters before another request can populate them.
    cascadeAbort?.abort(); cascading = false;
    const index = dependent.indexOf(name);
    if (index >= 0) {
      dependent.slice(index + 1).forEach(resetSelect);
      cascade(name);
    } else if (pendingCascade) cascade(pendingCascade);
    else ready();
    ui('view').textContent = type === 'revaluation' ? 'Revaluation Events' : `${el('mode').value === 'effective' ? 'Effective' : 'Original'} Result`;
  });
  form.addEventListener('submit', event => { event.preventDefault(); generate(); });
  form.addEventListener('reset', event => {
    event.preventDefault();
    invalidate(); cascadeAbort?.abort(); cascading = false;
    dependent.slice(1).forEach(resetSelect);
    el('batch_id').value = '';
    for (const name of ['exam_type', 'result_status', 'revaluation_status']) if (el(name)) el(name).value = '';
    if (el('mode')) el('mode').value = 'effective';
    if (el('pageSize')) el('pageSize').value = '25';
    ui('view').textContent = type === 'revaluation' ? 'Revaluation Events' : 'Effective Result';
    ui('filter-state').textContent = '';
    if (el('batch_id').disabled) cascade('initial');
    else ready();
  });
  ui('prev').addEventListener('click', () => { if (!generating && currentPage > 1) generate(currentPage - 1); });
  ui('next').addEventListener('click', () => { if (!generating && currentPage < totalPages) generate(currentPage + 1); });
  cascade('initial');
})();
