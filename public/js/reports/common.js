'use strict';

(() => {
  const root = document.getElementById('reports-page');
  if (!root) return;
  const type = root.dataset.reportType;
  const form = document.getElementById('reports-filters');
  const el = name => document.getElementById(`report-${name}`);
  const ui = name => document.getElementById(`reports-${name}`);
  const required = ['batch_id', ...(type === 'student' ? ['student_id'] : []), ...(type === 'student-progress' ? [] : ['semester', 'exam_session_id']), ...(type === 'subject' ? ['subject_id'] : [])];
  const dependent = ['batch_id', ...(type === 'student' ? ['student_id'] : []), ...(type === 'student-progress' ? [] : ['semester', 'exam_session_id']), ...(type === 'student' ? ['attempt_no'] : []), ...(['subject', 'revaluation'].includes(type) ? ['subject_id'] : [])];
  let version = 0;
  let cascadeAbort;
  let reportAbort;
  let cascading = false;
  let cascadeName;
  let generating = false;
  let currentPage = 1;
  let totalPages = 0;
  let generatedQuery;
  const studentSearch = type === 'student' ? el('student-search') : null;
  let studentSearchTimer;

  function missingRequired() {
    const names = [...required, ...(type === 'student' && el('exam_session_id').value !== 'all' ? ['attempt_no'] : [])];
    return names.some(name => !el(name).value || el(name).disabled);
  }

  function ready() {
    ui('generate').disabled = cascading || generating || missingRequired();
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
    window.dispatchEvent(new Event('reports:clear'));
  }

  function placeholder(name) {
    const select = el(name);
    if (type === 'student' && name === 'semester') return 'All Completed Semesters';
    if (type === 'student' && name === 'exam_session_id') return 'All Exam Sessions';
    return type === 'revaluation' && name === 'subject_id' ? 'All Subjects' : `Select ${select.labels[0].textContent}`;
  }

  function resetSelect(name) {
    const select = el(name);
    if (!select) return;
    select.replaceChildren(new Option(placeholder(name), ''));
    select.disabled = true;
    if (name === 'attempt_no') select.closest('[data-report-filter]').hidden = true;
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
    const all = type === 'student' && ['semester', 'exam_session_id'].includes(name);
    select.replaceChildren(new Option(options.length ? placeholder(name) : `No ${name === 'attempt_no' ? 'results' : select.labels[0].textContent.toLowerCase()} available`, options.length && all ? 'all' : ''));
    options.forEach(row => select.add(new Option(label(row), String(row[key]))));
    select.disabled = !options.length;
    if (name === 'attempt_no' && options.length === 1) select.value = String(options[0][key]);
    if (name === 'student_id' && studentSearch?.value.trim() && options.length === 1) select.value = String(options[0][key]);
    if (name === 'attempt_no') select.closest('[data-report-filter]').hidden = !options.length;
    ui('filter-state').textContent = options.length ? (name === 'student_id' && studentSearch?.value.trim() ? `${options.length} students found.` : '') : select.options[0].textContent;
  }

  async function studentPeriods(query, signal, expectedVersion) {
    query.set('student_id', el('student_id').value);
    await load('semester', `api/student-semesters?${query}`, 'semester', row => `Semester ${row.semester}`, signal, expectedVersion);
    if (el('semester').value && expectedVersion === version) {
      query.set('semester', el('semester').value);
      await load('exam_session_id', `api/student-sessions?${query}`, 'exam_session_id', row => `${ExamPeriod.format(row)} - Semester ${row.semester}`, signal, expectedVersion);
    }
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
    if (studentSearch) studentSearch.disabled = !batch;
    const query = new URLSearchParams({ batch_id: batch });
    try {
      if (name === 'initial') await load('batch_id', 'api/batches', 'batch_id', row => `${row.batch_name} (${row.start_year}-${row.end_year})`, signal, expectedVersion);
      else if (!batch) ui('filter-state').textContent = '';
      else if (type === 'student-progress') ui('filter-state').textContent = '';
      else if (name === 'batch_id' && type === 'student') {
        const search = new URLSearchParams();
        if (studentSearch.value.trim()) search.set('search', studentSearch.value.trim());
        await load('student_id', `api/batches/${batch}/students?${search}`, 'student_id', row => `${row.usn} - ${row.student_name}`, signal, expectedVersion);
        if (expectedVersion === version && el('student_id').value) await studentPeriods(query, signal, expectedVersion);
      }
      else if (name === 'batch_id' || name === 'student_id') {
        if (type === 'student' && el('student_id').value) {
          await studentPeriods(query, signal, expectedVersion);
        } else if (type !== 'student') await load('semester', `api/batches/${batch}/semesters`, 'semester', row => row.semester, signal, expectedVersion);
        else ui('filter-state').textContent = '';
      } else if (name === 'semester' && el('semester').value) {
        query.set('semester', el('semester').value);
        if (type === 'student') query.set('student_id', el('student_id').value);
        await load('exam_session_id', `${type === 'student' ? 'api/student-sessions' : 'api/exam-sessions'}?${query}`, 'exam_session_id', row => `${ExamPeriod.format(row)} - Semester ${row.semester}`, signal, expectedVersion);
      } else if (name === 'exam_session_id' && el('exam_session_id').value && el('exam_session_id').value !== 'all') {
        query.set('exam_session_id', el('exam_session_id').value);
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
    if (GpaFormat.isKey(key)) return GpaFormat.format(value, '-');
    if (key.endsWith('_pass_percentage')) return String(Math.round(Number(value)));
    if (key === 'percentage') return Number(value).toFixed(2);
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

  function table(columns, rows, offset = 0) {
    const table = node('table', undefined, 'table table-hover align-middle reports-table');
    const thead = node('thead'); const tbody = node('tbody'); const header = node('tr');
    [{ label: 'Sl. No.' }, ...columns].forEach(column => {
      const th = node('th', column.label); th.scope = 'col'; if (column.title) th.title = column.title; header.append(th);
    });
    thead.append(header);
    rows.forEach((row, index) => {
      const tr = node('tr'); tr.append(node('td', offset + index + 1));
      columns.forEach(column => {
        const td = node('td');
        if (column.key.endsWith('status') && row[column.key]) td.append(node('span', display(column.key, row[column.key]), `badge reports-status reports-status-${row[column.key]}`));
        else td.textContent = display(column.key, row[column.key]);
        tr.append(td);
      });
      tbody.append(tr);
    });
    if (!rows.length) {
      const tr = node('tr'); const td = node('td', 'No subject results are stored for this attempt.', 'reports-table-empty'); td.colSpan = columns.length + 1; tr.append(td); tbody.append(tr);
    }
    table.append(thead, tbody); return table;
  }

  function summary(metrics) {
    return metrics.map(([label, value]) => {
      const metric = node('div'); metric.append(node('span', label), node('strong', display(GpaFormat.isKey(label) ? label : label === 'Overall Result' ? 'result_status' : '', value))); return metric;
    });
  }

  function renderSemesters(report) {
    const workspace = ui('semesters'); workspace.replaceChildren();
    workspace.classList.toggle('is-consolidated', report.semesters.length > 1);
    for (const term of report.semesters) {
      const section = node('section', undefined, 'reports-semester');
      section.append(node('h3', `Semester ${term.semester}`));
      for (const sitting of term.sessions) {
        const session = node('section', undefined, 'reports-student-session');
        session.append(node('h4', ExamPeriod.format(sitting.session)));
        for (const attempt of sitting.attempts) {
          const block = node('section', undefined, 'reports-student-attempt');
          block.append(node('h5', `Attempt ${attempt.result.attempt_no} - ${attempt.result.exam_type}`));
          const metrics = node('div', undefined, 'reports-summary'); metrics.append(...summary(attempt.metrics)); block.append(metrics);
          const wrap = node('div', undefined, 'table-responsive reports-table-wrap'); wrap.append(table(report.columns, attempt.subjects)); block.append(wrap); session.append(block);
        }
        section.append(session);
      }
      workspace.append(section);
    }
    if (!report.semesters.length) workspace.append(node('p', 'No persisted results match the selected student and filters.', 'reports-state'));
    workspace.hidden = false;
  }

  function consolidatedHeader(report) {
    const table = ui('table');
    table.classList.add('reports-consolidated');
    table.style.width = `${900 + report.subjects.length * 192}px`;
    const group = node('colgroup');
    const widths = [64, 156, 220, 80, 140, ...report.subjects.flatMap(() => [64, 64, 64]), 80, 80, 80];
    widths.forEach(width => { const col = node('col'); col.style.width = `${width}px`; group.append(col); });
    table.querySelector('colgroup')?.remove(); table.prepend(group);
    const top = node('tr'); const bottom = node('tr');
    [{ label: 'Sl. No.' }, ...report.fixedColumns].forEach((column, index) => {
      const th = node('th', column.label, index < 3 ? `reports-fixed-${index}` : undefined);
      th.scope = 'col'; th.rowSpan = 2; top.append(th);
    });
    report.subjects.forEach(subject => {
      const th = node('th', subject.subject_code); th.scope = 'colgroup'; th.colSpan = 3; th.title = subject.subject_name; top.append(th);
      ['EX', 'IA', 'T'].forEach(label => { const cell = node('th', label); cell.scope = 'col'; bottom.append(cell); });
    });
    report.trailingColumns.forEach(column => { const th = node('th', column.label); th.scope = 'col'; th.rowSpan = 2; top.append(th); });
    return [top, bottom];
  }

  function progressHeader(report) {
    const table = ui('table'); table.classList.add('reports-consolidated', 'reports-progress');
    table.style.width = `${550 + report.semesters.length * 560 + report.trailingColumns.length * 180 + report.completionColumns.length * 130}px`;
    const cols = node('colgroup');
    [64, 156, 220, 110, ...report.semesters.flatMap(() => [100, 80, 80, 110, 190]), ...report.trailingColumns.map(() => 180), ...report.completionColumns.map(() => 130)].forEach(width => { const col = node('col'); col.style.width = `${width}px`; cols.append(col); });
    table.querySelector('colgroup')?.remove(); table.prepend(cols);
    const top = node('tr'); const bottom = node('tr');
    [{ label: 'Sl. No.' }, ...report.fixedColumns].forEach((column, index) => { const th = node('th', column.label, `reports-fixed-${index}`); th.scope = 'col'; th.rowSpan = 2; top.append(th); });
    report.semesters.forEach((term, index) => {
      const th = node('th', `Semester ${term.semester}`, index % 2 ? 'reports-semester-alt' : undefined); th.scope = 'colgroup'; th.colSpan = 5; top.append(th);
      report.semesterColumns.forEach(column => { const th = node('th', column.label, index % 2 ? 'reports-semester-alt' : undefined); th.scope = 'col'; bottom.append(th); });
    });
    report.trailingColumns.forEach(column => { const th = node('th', column.label); th.scope = 'col'; th.rowSpan = 2; top.append(th); });
    ui('progress-title').textContent = report.formalTitle;
    report.completionGroups.forEach(group => {
      const th = node('th', undefined, 'reports-completion-group'); th.scope = 'colgroup'; th.colSpan = group.columns.length;
      th.append(document.createTextNode('Successfully Completed'), node('br'), document.createTextNode(group.label)); top.append(th);
      group.columns.forEach(column => { const cell = node('th', column.label, 'reports-year-completion'); cell.scope = 'col'; bottom.append(cell); });
    });
    ui('progress-notes').replaceChildren(...report.notes.map(note => node('li', note)));
    return [top, bottom];
  }

  function render(report) {
    if (window.renderReportBranding && report.branding) window.renderReportBranding(report.branding);
    const head = ui('table').querySelector('thead');
    const body = ui('table').querySelector('tbody');
    const header = node('tr');
    const numbered = type !== 'toppers';
    [...(numbered ? [{ label: 'Sl. No.' }] : []), ...report.columns].forEach(column => { const cell = node('th', column.label); cell.scope = 'col'; if (column.title) cell.title = column.title; header.append(cell); });
    head.replaceChildren(...(type === 'consolidated' ? consolidatedHeader(report) : type === 'student-progress' ? progressHeader(report) : [header]));
    const fragment = document.createDocumentFragment();
    report.rows.forEach((row, index) => {
      const tr = node('tr');
      if (numbered) tr.append(node('td', (report.pagination.page - 1) * report.pagination.pageSize + index + 1, ['consolidated', 'student-progress'].includes(type) ? 'reports-fixed-0' : undefined));
      report.columns.forEach((column, index) => {
        const td = node('td', undefined, (type === 'consolidated' && index < 2) || (type === 'student-progress' && index < 3) ? `reports-fixed-${index + 1}` : undefined);
        if (column.key === 'usn') td.classList.add('reports-usn');
        if (column.key === 'student_name') td.classList.add('reports-student-name');
        if (column.key === 'subject_name') td.classList.add('reports-subject-name');
        if (type === 'student-progress' && typeof column.group === 'number') {
          if (column.group % 2) td.classList.add('reports-semester-alt');
          const result = row.semesters[report.semesters[column.group].semester].displayed_result;
          if (result && /_(marks|sgpa|cgpa)$/.test(column.key)) td.title = `${ExamPeriod.format(result)}; attempt ${result.attempt_no}; ${result.exam_type}`;
        }
        if (type === 'student-progress' && column.key === 'latest_cgpa' && row.latest_cgpa_source) {
          const result = row.latest_cgpa_source; td.title = `Semester ${result.semester}; ${ExamPeriod.format(result)}; attempt ${result.attempt_no}; ${result.exam_type}`;
        }
        const annotated = type === 'consolidated' ? row.consolidated_display?.[column.key] : undefined;
        const text = annotated ?? display(column.key, row[column.key]);
        if (annotated) td.classList.add('reports-revaluation-cell');
        if (type === 'student-progress' && /^year_\d+_/.test(column.key)) td.classList.add('reports-year-completion');
        if (column.key.endsWith('status') && row[column.key]) td.append(node('span', text, `badge reports-status reports-status-${row[column.key]}`));
        else td.textContent = text;
        tr.append(td);
      });
      fragment.append(tr);
    });
    if (!report.rows.length) {
      const tr = node('tr');
      const td = node('td', { student: 'No subject results are stored for this attempt.', 'student-progress': 'No students belong to the selected batch.', class: 'No result attempts match the selected filters.', consolidated: 'No result attempts match the selected filters.', 'result-analysis': 'No subjects belong to the selected exam session.', subject: 'No subject result attempts match the selected filters.', revaluation: 'No persisted revaluation events match the selected filters.', toppers: 'No passing results with a stored CGPA match the selected filters.' }[type], 'reports-table-empty');
      td.colSpan = report.columns.length + Number(numbered);
      tr.append(td); fragment.append(tr);
    }
    body.replaceChildren(fragment);
    ui('summary').replaceChildren(...summary(report.metrics));
    ui('flat-table').hidden = type === 'student';
    if (type === 'student') renderSemesters(report);
    ui('context').replaceChildren(...ReportWording.visible(report.context).map(([label, value]) => {
      const pair = node('div'); pair.append(node('dt', label), node('dd', value)); return pair;
    }));
    ui('calculation-notes').replaceChildren(...ReportWording.details(report).map(text => node('li', text)));
    currentPage = report.pagination.page;
    totalPages = report.pagination.totalPages;
    ui('page-info').textContent = totalPages ? `Page ${currentPage} of ${totalPages} / ${report.pagination.totalRows} rows` : '0 rows';
    ui('prev').disabled = currentPage <= 1;
    ui('next').disabled = currentPage >= totalPages;
    ui('pagination').hidden = ['student', 'result-analysis'].includes(type) || totalPages <= 1;
    ui('view').textContent = type === 'revaluation' ? 'Revaluation Events' : `${report.filters.mode === 'effective' ? 'Effective' : 'Original'} Result`;
    ui('output').hidden = false;
    ui('empty').hidden = true;
    ui('csv').href = `/reports/${type}/export.csv?${generatedQuery}`;
    ui('print').href = `/reports/${type}/print?${generatedQuery}`;
    window.dispatchEvent(new CustomEvent('reports:render', { detail: report }));
  }

  async function generate(page = 1) {
    if (missingRequired()) return;
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
    if (event.target === studentSearch) return;
    clearTimeout(studentSearchTimer);
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
    clearTimeout(studentSearchTimer);
    if (studentSearch) { studentSearch.value = ''; studentSearch.disabled = true; }
    invalidate(); cascadeAbort?.abort(); cascading = false;
    dependent.slice(1).forEach(resetSelect);
    el('batch_id').value = el('batch_id').options[1]?.value || '';
    for (const name of ['exam_type', 'result_status', 'revaluation_status']) if (el(name)) el(name).value = '';
    if (el('mode')) el('mode').value = type === 'toppers' ? 'original' : 'effective';
    if (el('pageSize')) el('pageSize').value = '25';
    ui('view').textContent = type === 'revaluation' ? 'Revaluation Events' : type === 'toppers' ? 'Original Result' : 'Effective Result';
    ui('filter-state').textContent = '';
    if (el('batch_id').disabled) initialize(false);
    else if (el('batch_id').value) cascade('batch_id');
    else ready();
  });
  ui('prev').addEventListener('click', () => { if (!generating && currentPage > 1) generate(currentPage - 1); });
  ui('next').addEventListener('click', () => { if (!generating && currentPage < totalPages) generate(currentPage + 1); });
  if (studentSearch) studentSearch.addEventListener('input', () => {
    clearTimeout(studentSearchTimer);
    invalidate(); cascadeAbort?.abort();
    dependent.slice(1).forEach(resetSelect);
    cascadeName = 'batch_id';
    cascading = !!el('batch_id').value;
    ready();
    ui('filter-state').textContent = cascading ? 'Searching students...' : '';
    if (cascading) studentSearchTimer = setTimeout(() => cascade('batch_id'), 300);
  });
  async function initialize(useQuery = true) {
    const query = new URLSearchParams(useQuery ? location.search : '');
    const initialVersion = version;
    await cascade('initial');
    for (const name of dependent) {
      if (version !== initialVersion) return;
      const select = el(name), value = query.get(name) || (name === 'batch_id' ? select.options[1]?.value : undefined);
      if (!value || select.disabled || !Array.from(select.options).some(o => o.value === value)) continue;
      select.value = value;
      await cascade(name);
    }
    if (version !== initialVersion) return;
    if (el('mode') && Array.from(el('mode').options).some(o => o.value === query.get('mode'))) el('mode').value = query.get('mode');
    ui('view').textContent = type === 'revaluation' ? 'Revaluation Events' : `${el('mode').value === 'effective' ? 'Effective' : 'Original'} Result`;
    ready();
  }
  initialize();
})();
