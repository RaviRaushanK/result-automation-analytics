'use strict';

const repository = require('../repositories/reportsRepository');
const TYPES = ['student', 'class', 'subject', 'revaluation', 'toppers', 'consolidated', 'result-analysis', 'student-progress'];
const TITLES = { student: 'Student Result Report', class: 'Class Result Report', subject: 'Subject Result Report', revaluation: 'Revaluation Report', toppers: 'Toppers Report', consolidated: 'Consolidated Result Report', 'result-analysis': 'Result Analysis Report' };
TITLES['student-progress'] = 'All Students Progress Report';

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function integer(value, name, required = false) {
  if (value === undefined || value === '') {
    if (required) invalid(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') invalid(`Invalid ${name}.`);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) invalid(`Invalid ${name}.`);
  return Number(value);
}

function choice(value, name, allowed, fallback) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(`Invalid ${name}.`);
  return value;
}

function semester(value, required = true) {
  if (value === undefined || value === '') {
    if (required) invalid('Semester is required.');
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 20) invalid('Invalid semester.');
  return value.trim();
}

function normalize(type, query) {
  if (!TYPES.includes(type)) invalid('Unknown report.', 404);
  const f = {
    batch_id: integer(query.batch_id, 'Batch', true),
    session_id: integer(type === 'student' && query.session_id === 'all' ? undefined : query.session_id, 'Result session', !['student', 'student-progress'].includes(type)),
    semester: semester(type === 'student' && query.semester === 'all' ? undefined : query.semester, !['student', 'student-progress'].includes(type)),
    student_id: integer(query.student_id, 'Student', type === 'student'),
    subject_id: integer(query.subject_id, 'Subject', type === 'subject'),
    attempt_no: integer(query.attempt_no, 'Attempt'),
    mode: choice(query.mode, 'Result view', type === 'toppers' ? ['original'] : ['original', 'effective'], type === 'toppers' ? 'original' : 'effective'),
    exam_type: choice(query.exam_type, 'Exam type', ['REGULAR', 'BACKLOG', 'SUPPLEMENTARY', 'REPEAT']),
    result_status: choice(query.result_status, 'Result status', ['pass', 'fail']),
    revaluation_status: choice(query.revaluation_status, 'Revaluation status', ['pending', 'approved', 'rejected']),
    page: integer(query.page, 'Page') || 1,
    pageSize: integer(query.pageSize, 'Page size') || 25
  };
  if (![25, 50, 100].includes(f.pageSize)) invalid('Page size must be 25, 50 or 100.');
  // Each report accepts only filters with a defined meaning for its dataset.
  if (type !== 'student' && (f.student_id || f.attempt_no)) invalid('Student and attempt filters are only supported by Student Result.');
  if (type === 'student' && (f.subject_id || f.exam_type || f.result_status || f.revaluation_status)) invalid('Unsupported Student Result filter.');
  if (type === 'student' && f.attempt_no && !f.session_id) invalid('An exact attempt requires a specific result session.');
  if (type === 'class' && (f.subject_id || f.revaluation_status)) invalid('Unsupported Class Result filter.');
  if (type === 'toppers' && (f.subject_id || f.revaluation_status || f.result_status)) invalid('Unsupported Toppers filter.');
  if (type === 'consolidated' && (f.subject_id || f.revaluation_status || f.result_status)) invalid('Unsupported Consolidated Result filter.');
  if (type === 'result-analysis' && (f.subject_id || f.revaluation_status || f.result_status || f.exam_type)) invalid('Unsupported Result Analysis filter.');
  if (type === 'student-progress' && (f.session_id || f.semester || f.subject_id || f.exam_type || f.result_status || f.revaluation_status)) invalid('Student Progress supports Batch and Result View only.');
  if (type === 'subject' && (f.exam_type || f.revaluation_status)) invalid('Unsupported Subject Result filter.');
  if (type === 'revaluation' && (f.exam_type || f.result_status)) invalid('Unsupported Revaluation filter.');
  return f;
}

async function requireBatch(batchId) {
  const batch = await repository.batch(batchId);
  if (!batch) invalid('Batch not found.', 404);
  return batch;
}

async function context(type, f) {
  const batch = await requireBatch(f.batch_id);
  const session = await repository.session(f.session_id, f.batch_id, f.semester);
  if (!session) invalid('Result session does not belong to the selected batch and semester.', 404);
  const meta = { batch, session };
  if (f.subject_id) {
    meta.subject = await repository.subject(f.subject_id, f.session_id);
    if (!meta.subject) invalid('Subject does not belong to the selected result session.', 404);
  }
  return meta;
}

async function getOptions(scope, query = {}) {
  const f = {};
  if (scope === 'batches') return repository.options(scope, f);
  if (!['students', 'semesters', 'sessions', 'subjects', 'student-results', 'student-semesters', 'student-sessions'].includes(scope)) invalid('Unknown filter.', 404);
  f.batch_id = integer(query.batch_id, 'Batch', true);
  await requireBatch(f.batch_id);
  if (scope === 'sessions') f.semester = semester(query.semester);
  if (scope === 'subjects' || scope === 'student-results') {
    f.session_id = integer(query.session_id, 'Result session', true);
    if (!await repository.session(f.session_id, f.batch_id)) invalid('Result session does not belong to the selected batch.', 404);
  }
  if (scope === 'student-sessions') f.semester = semester(query.semester === 'all' ? undefined : query.semester, false);
  if (['student-results', 'student-semesters', 'student-sessions'].includes(scope)) {
    f.student_id = integer(query.student_id, 'Student', true);
    if (!await repository.student(f.student_id, f.batch_id)) invalid('Student does not belong to the selected batch.', 404);
  }
  const rows = await repository.options(scope, f);
  if (scope === 'student-semesters') rows.sort((a, b) => String(a.semester).localeCompare(String(b.semester), 'en', { numeric: true }));
  return rows;
}

function columns(type, mode) {
  const identity = [['usn', 'USN'], ['student_name', 'Student Name']];
  const attempt = [['attempt_no', 'Attempt No.'], ['exam_type', 'Exam Type']];
  const outcome = [['internal_marks', 'IA'], ['external_marks', 'External'], ['marks', 'Total'], ['max_marks', 'Max Marks'], ['grade', 'Grade'], ['result_status', 'Result']];
  let pairs;
  if (type === 'student') pairs = [['subject_code', 'Subject Code'], ['subject_name', 'Subject Name'], ['credits', 'Credits'], ...outcome];
  if (type === 'class') pairs = [...identity, ...attempt, ['subjects', 'Subjects'], ['passed', 'Passed'], ['failed', 'Failed'], ['result_status', 'Result'], ...(mode === 'original' ? [['sgpa', 'SGPA'], ['cgpa', 'CGPA']] : [])];
  if (type === 'toppers') pairs = [['position', 'Rank'], ...identity, ...attempt, ['subjects', 'Subjects'], ['passed', 'Passed'], ['total_marks', 'Total'], ['sgpa', 'SGPA'], ['cgpa', 'CGPA'], ['percentage', '% Percentage'], ['result_status', 'Result']];
  if (type === 'subject') pairs = [...identity, ...attempt, ...outcome];
  if (type === 'revaluation') pairs = [...identity, ...attempt, ['subject_code', 'Subject Code'], ['subject_name', 'Subject Name'], ['revaluation_no', 'Revaluation No.'], ['original_marks', 'Original Marks'], ['original_status', 'Original Result'], ['revised_marks', 'Revised Marks'], ['revised_grade', 'Revised Grade'], ['revised_status', 'Revised Result'], ['revaluation_status', 'Revaluation Status'], ['is_effective', 'Effective'], ['reviewed_at', 'Reviewed At']];
  if (mode === 'effective' && type !== 'class' && type !== 'revaluation') pairs.push(['revaluated', 'Revaluated']);
  return pairs.map(([key, label]) => ({ key, label, ...(key === 'internal_marks' ? { title: 'Original Internal Assessment marks' } : key === 'external_marks' ? { title: 'Original External / SEE marks' } : {}) }));
}

function subjectSummary(rows) {
  return { total_rows: rows.length, passed: rows.filter(row => row.result_status === 'pass').length,
    failed: rows.filter(row => row.result_status === 'fail').length,
    unavailable: rows.filter(row => !['pass', 'fail'].includes(row.result_status)).length };
}

async function studentReport(filters) {
  const batch = await requireBatch(filters.batch_id);
  const student = await repository.student(filters.student_id, filters.batch_id);
  if (!student) invalid('Student does not belong to the selected batch.', 404);
  let session;
  if (filters.session_id) {
    session = await repository.session(filters.session_id, filters.batch_id, filters.semester);
    if (!session) invalid('Result session does not belong to the selected batch and semester.', 404);
  }
  const results = await repository.studentResults(filters);
  if (session) {
    if (!results.length) invalid('The selected result attempt was not found for this student.', 404);
    if (!filters.attempt_no && results.length > 1) invalid('Select an attempt for this student and session.');
    if (!filters.attempt_no) filters.attempt_no = Number(results[0].attempt_no);
  }
  const subjects = await repository.studentSubjects(filters);
  const byResult = new Map();
  for (const row of subjects) {
    const key = String(row.result_id);
    if (!byResult.has(key)) byResult.set(key, []);
    byResult.get(key).push({ ...row, result_view: filters.mode === 'effective' ? 'Effective Result' : 'Original Result' });
  }
  // ResultSession stores three-letter calendar months (sessionController).
  const month = value => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(String(value).toLowerCase());
  results.sort((a, b) => String(a.semester).localeCompare(String(b.semester), 'en', { numeric: true })
    || Number(a.exam_year) - Number(b.exam_year) || month(a.exam_session) - month(b.exam_session) || String(a.exam_session).localeCompare(String(b.exam_session))
    || Number(a.session_id) - Number(b.session_id) || Number(a.attempt_no) - Number(b.attempt_no));
  const semesters = [];
  for (const result of results) {
    let term = semesters.find(term => String(term.semester) === String(result.semester));
    if (!term) { term = { semester: result.semester, sessions: [] }; semesters.push(term); }
    let sitting = term.sessions.find(sitting => String(sitting.session.session_id) === String(result.session_id));
    if (!sitting) {
      sitting = { session: { session_id: result.session_id, semester: result.semester, exam_session: result.exam_session, exam_year: result.exam_year }, attempts: [] };
      term.sessions.push(sitting);
    }
    const rows = byResult.get(String(result.result_id)) || [];
    sitting.attempts.push({ result, subjects: rows, metrics: metrics('student', subjectSummary(rows), { result }, filters.mode) });
  }
  const rows = semesters.flatMap(term => term.sessions.flatMap(sitting => sitting.attempts.flatMap(attempt => attempt.subjects)));
  const meta = { batch, student, ...(session ? { session } : {}), ...(results.length === 1 ? { result: results[0] } : {}) };
  const report = { type: 'student', title: TITLES.student, filters, meta, semesters, rows,
    metrics: results.length === 1 ? metrics('student', subjectSummary(rows), meta, filters.mode)
      : [['Semesters', semesters.length], ['Result Attempts', results.length], ...metrics('student', subjectSummary(rows), {}, 'effective').map(([label, value]) => [label === 'Subjects' ? 'Subject Attempts' : label, value])],
    columns: columns('student', filters.mode),
    pagination: { page: 1, pageSize: Math.max(rows.length, 1), totalRows: rows.length, totalPages: rows.length ? 1 : 0 }, generatedAt: new Date().toISOString() };
  report.context = contextLines(report);
  return report;
}

function metrics(type, summary, meta, mode) {
  const s = Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value === null ? null : Number(value)]));
  const total = s.total_rows || 0;
  if (type === 'toppers') return [['Eligible Result Attempts', total], ['Students', s.students || 0], ['Highest Stored CGPA', summary.highest_cgpa ?? '-']];
  if (type === 'consolidated') return [['Students', s.students || 0], ['Result Attempts', total], ['Passed', s.passed || 0], ['Failed', s.failed || 0], ['Result Unavailable', s.unavailable || 0], ['Pass %', total ? ((s.passed || 0) / total * 100).toFixed(2) : '-']];
  if (type === 'revaluation') return [['Total Revaluation Events', total], ['Approved', s.approved || 0], ['Pending', s.pending || 0], ['Rejected', s.rejected || 0], ['Effective', s.effective || 0]];
  const base = [[type === 'class' ? 'Total Result Rows' : type === 'subject' ? 'Total Attempts' : 'Subjects', total], ['Passed', s.passed || 0], ['Failed', s.failed || 0]];
  if (s.unavailable) base.push(['Result Unavailable', s.unavailable]);
  if (type === 'class') base.push(['Students', s.students || 0]);
  if (type === 'subject') base.push(['Pass Percentage', total ? `${((s.passed || 0) / total * 100).toFixed(2)}%` : '-'], ['Average Marks', s.average_marks === null ? '-' : s.average_marks.toFixed(2)], ['Highest Marks', s.highest_marks], ['Lowest Marks', s.lowest_marks]);
  if (type === 'student' && mode === 'original') base.push(['SGPA', meta.result.sgpa], ['CGPA', meta.result.cgpa], ['Overall Result', meta.result.result_status], ['Stored Failed Subject Count', meta.result.failed_subject_count]);
  return base.map(([label, value]) => [label, value === null || value === undefined ? '-' : value]);
}

async function prepare(type, query) {
  const filters = normalize(type, query);
  if (type === 'student') return studentReport(filters);
  if (type === 'result-analysis') return resultAnalysisReport(filters);
  if (type === 'student-progress') return prepareProgress(filters);
  const meta = await context(type, filters);
  const summary = await repository.summary(type, filters);
  const totalRows = Number(summary.total_rows) || 0;
  const pageSize = type === 'student' ? Math.max(totalRows, 1) : filters.pageSize;
  const totalPages = Math.ceil(totalRows / pageSize);
  const page = Math.min(filters.page, Math.max(totalPages, 1));
  const report = { type, title: TITLES[type], filters, meta, metrics: metrics(type, summary, meta, filters.mode),
    columns: type === 'consolidated' ? [] : columns(type, filters.mode), pagination: { page, pageSize, totalRows, totalPages }, generatedAt: new Date().toISOString() };
  if (type === 'consolidated') {
    report.subjects = await repository.sessionSubjects(filters);
    report.fixedColumns = [['usn', 'USN'], ['student_name', 'Name'], ['attempt_no', 'Attempt'], ['exam_type', 'Exam Type']].map(([key, label]) => ({ key, label }));
    report.trailingColumns = [['total_marks', 'TOTAL'], ['percentage', '%'], ['sgpa', filters.mode === 'effective' ? 'SGPA (Stored)' : 'SGPA']].map(([key, label]) => ({ key, label }));
    report.columns = [...report.fixedColumns, ...report.subjects.flatMap(subject => ['EX', 'IA', 'T'].map(component => ({ key: subjectKey(subject.subject_id, component), label: `${subject.subject_code} ${component}` }))), ...report.trailingColumns];
    report.metrics.splice(2, 0, ['Subjects', report.subjects.length]);
  }
  report.context = contextLines(report);
  return report;
}

async function getReport(type, query) {
  const report = await prepare(type, query);
  if (type === 'student' || type === 'result-analysis') return report;
  const { page, pageSize } = report.pagination;
  if (type === 'student-progress') {
    report.rows = await progressRows(report, pageSize, (page - 1) * pageSize);
    return report;
  }
  report.rows = await repository.rows(type, report.filters, pageSize, (page - 1) * pageSize);
  if (type === 'consolidated') report.rows = await pivotConsolidated(report, report.rows);
  return report;
}

async function* fullRows(report) {
  if (report.type === 'student' || report.type === 'result-analysis') { yield* report.rows; return; }
  // Full exports are fetched in chunks without the preview's page-size cap.
  for (let offset = 0; ; offset += 1000) {
    let rows = report.type === 'student-progress' ? await progressRows(report, 1000, offset) : await repository.rows(report.type, report.filters, 1000, offset);
    if (report.type === 'consolidated') rows = await pivotConsolidated(report, rows);
    for (const row of rows) yield row;
    if (rows.length < 1000) break;
  }
}

function resultOrder(a, b) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return String(a.semester).localeCompare(String(b.semester), 'en', { numeric: true }) || Number(a.exam_year) - Number(b.exam_year)
    || months.indexOf(String(a.exam_session).toLowerCase()) - months.indexOf(String(b.exam_session).toLowerCase())
    || String(a.exam_session).localeCompare(String(b.exam_session)) || Number(a.session_id) - Number(b.session_id)
    || Number(a.attempt_no) - Number(b.attempt_no) || Number(a.result_id) - Number(b.result_id);
}
const PROGRESS_FIELDS = [['marks', 'Marks Obt.'], ['sgpa', 'SGPA'], ['cgpa', 'CGPA'], ['first_attempt', 'First Attempt'], ['supplementary_pass', 'Pass in Suply']];
function progressKey(term, field) { return `semester_${term}_${field}`; }

async function prepareProgress(filters) {
  const batch = await requireBatch(filters.batch_id);
  const semesters = await repository.progressSemesters(filters);
  semesters.sort((a, b) => String(a.semester).localeCompare(String(b.semester), 'en', { numeric: true }));
  const requiredSubjects = await repository.progressRequiredSubjects(filters);
  const summary = await repository.progressStudentCount(filters);
  const totalRows = Number(summary.total_rows);
  const totalPages = Math.ceil(totalRows / filters.pageSize);
  const report = { type: 'student-progress', title: TITLES['student-progress'], filters, meta: { batch }, semesters, requiredSubjects,
    fixedColumns: [['usn', 'USN'], ['student_name', 'Name'], ['category', 'Category']].map(([key, label]) => ({ key, label })),
    semesterColumns: PROGRESS_FIELDS.map(([key, label]) => ({ key, label })), trailingColumns: [{ key: 'latest_cgpa', label: 'Latest Stored CGPA' }],
    formalTitle: `Results of Students Admitted during the Year ${batch.start_year}`,
    notes: ['Marks/SGPA/CGPA use the earliest regular sitting, or the earliest observed sitting if no regular result exists. No attempts are merged into a new GPA.',
      'First Attempt requires a recorded REGULAR attempt 1. Supplementary clearance requires all subjects of that first session to be cleared by later same-session attempts. Cross-session subject equivalence is not assumed.',
      'SGPA/CGPA are stored academic header values; effective marks may reflect approved revaluation. The import calculates CGPA from the individual attempt, so Latest Stored CGPA is not certified final programme CGPA.'],
    metrics: [['Students', totalRows], ['Semesters Available', semesters.length]],
    pagination: { page: Math.min(filters.page, Math.max(totalPages, 1)), pageSize: filters.pageSize, totalRows, totalPages }, generatedAt: new Date().toISOString() };
  report.columns = [...report.fixedColumns, ...semesters.flatMap((term, group) => PROGRESS_FIELDS.map(([field, label]) => ({ key: progressKey(term.semester, field), label: `Semester ${term.semester} ${label}`, group }))), ...report.trailingColumns];
  report.context = contextLines(report);
  return report;
}

async function progressRows(report, limit, offset) {
  const students = await repository.progressStudents(report.filters, limit, offset);
  const ids = students.map(student => student.student_id);
  const results = await repository.progressResults(report.filters, ids);
  results.sort(resultOrder);
  const subjects = await repository.progressSubjectHistory(report.filters, ids);
  const byResult = new Map();
  for (const subject of subjects) {
    const id = String(subject.result_id);
    if (!byResult.has(id)) byResult.set(id, []);
    byResult.get(id).push(subject);
  }
  const byStudent = new Map();
  for (const result of results) {
    const id = String(result.student_id);
    if (!byStudent.has(id)) byStudent.set(id, []);
    byStudent.get(id).push(result);
  }
  const required = new Map();
  for (const subject of report.requiredSubjects) {
    const id = String(subject.session_id);
    if (!required.has(id)) required.set(id, []);
    required.get(id).push(String(subject.subject_id));
  }
  return students.map(student => {
    const history = byStudent.get(String(student.student_id)) || [];
    const row = { ...student, semesters: {}, latest_cgpa: null };
    for (const term of report.semesters) {
      const attempts = history.filter(result => String(result.semester) === String(term.semester));
      const displayed = attempts.find(result => result.exam_type === 'REGULAR') || attempts[0];
      const values = { marks: null, sgpa: null, cgpa: null, first_attempt: '-', supplementary_pass: '-', displayed_result: displayed || null };
      if (displayed) {
        values.marks = displayed.total_marks; values.sgpa = displayed.sgpa; values.cgpa = displayed.cgpa;
        const requiredIds = required.get(String(displayed.session_id)) || [];
        const outcomes = new Map((byResult.get(String(displayed.result_id)) || []).map(subject => [String(subject.subject_id), subject.result_status]));
        const completePass = () => requiredIds.length > 0 && requiredIds.every(id => outcomes.get(id) === 'pass');
        if (displayed.exam_type === 'REGULAR' && Number(displayed.attempt_no) === 1) {
          if (displayed.result_status === 'fail') values.first_attempt = 'F';
          else if (displayed.result_status === 'pass' && completePass()) values.first_attempt = 'P';
        }
        if (values.first_attempt === 'F') {
          const later = attempts.slice(attempts.indexOf(displayed) + 1).filter(result => ['BACKLOG', 'SUPPLEMENTARY', 'REPEAT'].includes(result.exam_type));
          const unmapped = later.some(result => String(result.session_id) !== String(displayed.session_id));
          for (const result of later.filter(result => String(result.session_id) === String(displayed.session_id))) {
            for (const subject of byResult.get(String(result.result_id)) || []) outcomes.set(String(subject.subject_id), subject.result_status);
          }
          if (!unmapped && requiredIds.length) {
            if (later.length && completePass()) values.supplementary_pass = 'P';
            else if (requiredIds.some(id => outcomes.get(id) === 'fail')) values.supplementary_pass = 'F';
          }
        }
      }
      row.semesters[term.semester] = values;
      for (const [field] of PROGRESS_FIELDS) row[progressKey(term.semester, field)] = values[field];
    }
    const latest = [...history].reverse().find(result => result.cgpa !== null && result.cgpa !== undefined);
    if (latest) { row.latest_cgpa = latest.cgpa; row.latest_cgpa_source = latest; }
    return row;
  });
}

function passPercentage(passed, appeared) { return appeared ? Math.round(passed / appeared * 10000) / 100 : 0; }

async function resultAnalysisReport(filters) {
  const meta = await context('result-analysis', filters);
  const source = await repository.subjectAnalysis(filters);
  const staff = await repository.subjectStaff(filters);
  const summary = await repository.summary('class', filters);
  const staffBySubject = new Map();
  for (const person of staff) {
    const id = String(person.subject_id);
    if (!staffBySubject.has(id)) staffBySubject.set(id, []);
    staffBySubject.get(id).push(person.faculty_name);
  }
  const rows = source.map(subject => {
    const regular = { appeared: Number(subject.regular_appeared), passed: Number(subject.regular_passed) };
    const repeaters = { appeared: Number(subject.repeaters_appeared), passed: Number(subject.repeaters_passed) };
    const total = { appeared: regular.appeared + repeaters.appeared, passed: regular.passed + repeaters.passed };
    const facultyNames = staffBySubject.get(String(subject.subject_id)) || [];
    const row = { subject_id: subject.subject_id, subject_code: subject.subject_code, subject_name: subject.subject_name, facultyNames, staff: facultyNames.join(' / ') || '-' };
    for (const [group, values] of Object.entries({ regular, repeaters, total })) {
      values.passPercentage = passPercentage(values.passed, values.appeared);
      row[group] = values;
      row[`${group}_appeared`] = values.appeared;
      row[`${group}_passed`] = values.passed;
      row[`${group}_pass_percentage`] = values.passPercentage;
    }
    return row;
  });
  const overall = { appeared: Number(summary.total_rows) || 0, passed: Number(summary.passed) || 0,
    failed: Number(summary.failed) || 0, unavailable: Number(summary.unavailable) || 0 };
  overall.passPercentage = passPercentage(overall.passed, overall.appeared);
  const groups = ['regular', 'repeaters', 'total'].flatMap(group => [['appeared', 'APP'], ['passed', 'PASS'], ['pass_percentage', '% PASS']].map(([key, label]) => ({ key: `${group}_${key}`, label: `${group === 'repeaters' ? 'Repeaters' : group === 'regular' ? 'Regular' : 'Total'} ${label}` })));
  const report = { type: 'result-analysis', title: TITLES['result-analysis'], filters, meta, rows, subjects: rows, overall,
    formalHeader: { title: `RESULTS ANALYSIS CHART OF ${meta.session.semester} SEM MCA`, examination: `${meta.session.exam_session} ${meta.session.exam_year} EXAMINATION` },
    columns: [{ key: 'subject_code', label: 'Subject Code' }, { key: 'subject_name', label: 'Name of the Subject' }, ...groups, { key: 'staff', label: 'Name of the Staff' }],
    chart: { labels: rows.map(row => row.subject_code), values: rows.map(row => row.total.passPercentage) },
    metrics: [['TOTAL APP', overall.appeared], ['TOTAL FAIL', overall.failed], ['TOTAL PASS', overall.passed], ['%', overall.passPercentage.toFixed(2)], ...(overall.unavailable ? [['RESULT UNAVAILABLE', overall.unavailable]] : [])],
    pagination: { page: 1, pageSize: Math.max(rows.length, 1), totalRows: rows.length, totalPages: rows.length ? 1 : 0 }, generatedAt: new Date().toISOString() };
  report.context = contextLines(report);
  return report;
}

function subjectKey(id, component) { return `subject_${id}_${component}`; }

async function pivotConsolidated(report, rows) {
  const cells = await repository.consolidatedSubjects(report.filters, rows.map(row => row.result_id));
  const byResult = new Map(rows.map(row => [String(row.result_id), { ...row, subject_marks: {},
    ...Object.fromEntries(report.subjects.flatMap(subject => ['EX', 'IA', 'T'].map(component => [subjectKey(subject.subject_id, component), null]))) }]));
  for (const cell of cells) {
    const row = byResult.get(String(cell.result_id));
    row.subject_marks[cell.subject_id] = { external: cell.external_marks, internal: cell.internal_marks, total: cell.marks, effective: Boolean(Number(cell.revaluated)) };
    for (const [component, value] of [['EX', cell.external_marks], ['IA', cell.internal_marks], ['T', cell.marks]]) row[subjectKey(cell.subject_id, component)] = value;
  }
  return rows.map(row => byResult.get(String(row.result_id)));
}

function display(key, value) {
  if (value === null || value === undefined || value === '') return '-';
  if (/(^|_)(sgpa|cgpa)$/.test(key) && Number.isFinite(Number(value))) return Number(value).toFixed(2);
  if (key.endsWith('_pass_percentage')) return String(Math.round(Number(value)));
  if (key === 'percentage') return Number(value).toFixed(2);
  if (key === 'is_effective' || key === 'revaluated') return Number(value) ? 'Yes' : 'No';
  if (key.endsWith('status')) return String(value).toUpperCase();
  if (key === 'reviewed_at') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toISOString();
  }
  return String(value);
}

function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet formula protection applies to untrusted text, including names.
  if (text !== '-' && /^[\s\uFEFF]*[=+@-]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function filename(report) {
  const component = report.meta.student?.usn || report.meta.subject?.subject_code || report.meta.batch.batch_name;
  const prefix = report.type === 'revaluation' ? 'revaluation-report' : report.type === 'result-analysis' ? 'result-analysis-report' : `${report.type}-result`;
  const suffix = report.type === 'revaluation' ? '' : `_${report.filters.mode}`;
  const session = report.meta.session;
  const scope = session ? `${session.semester}_${session.exam_session}_${session.exam_year}` : `${report.filters.semester || 'all-semesters'}_all-sessions`;
  const safe = `${prefix}_${component}_${scope}${suffix}`
    .replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 180);
  return `${safe}.csv`;
}

function contextLines(report) {
  const { batch, session, student, subject, result } = report.meta;
  if (report.type === 'student-progress') return [['Programme', 'MCA'], ['Batch', batch.batch_name], ['Admission Year', batch.start_year], ['Result View', `${report.filters.mode === 'effective' ? 'Effective' : 'Original'} Result`], ['Generated At', report.generatedAt]];
  const lines = [['Programme', 'MCA'], ['Batch', batch.batch_name], ['Semester', session?.semester || report.filters.semester || 'All Completed Semesters'], ['Result Session', session ? `${session.exam_session} ${session.exam_year}` : 'All Result Sessions']];
  if (student) lines.push(['USN', student.usn], ['Student Name', student.student_name]);
  if (student && result) lines.push(['Attempt', `${result.attempt_no} - ${result.exam_type}`]);
  if (subject) lines.push(['Subject', `${subject.subject_code} - ${subject.subject_name}`], ['Credits', subject.credits], ['Max Marks', subject.max_marks]);
  if (report.type !== 'revaluation') lines.push(['Result View', `${report.filters.mode === 'effective' ? 'Effective' : 'Original'} Result`]);
  if (report.type === 'toppers') lines.push(['Ranking Basis', 'Stored original CGPA, descending'], ['Eligibility', 'Stored passing result, non-NULL CGPA, no failed original subject rows'], ['Tie Order', 'USN, attempt number, result ID']);
  if (report.type === 'consolidated' && report.filters.mode === 'effective') lines.push(['SGPA Basis', 'Stored original academic header; not recalculated after revaluation']);
  if (report.type === 'result-analysis') lines.push(['Participation Basis', 'Exact Result attempts; REGULAR vs BACKLOG / SUPPLEMENTARY / REPEAT']);
  if (report.filters.exam_type) lines.push(['Exam Type', report.filters.exam_type]);
  if (report.filters.result_status) lines.push(['Result Status', report.filters.result_status.toUpperCase()]);
  if (report.filters.revaluation_status) lines.push(['Revaluation Status', report.filters.revaluation_status.toUpperCase()]);
  lines.push(['Generated At', report.generatedAt]);
  return lines;
}

function exportColumns(report) {
  if (report.type !== 'student') return report.columns;
  return [['semester', 'Semester'], ['exam_session', 'Exam Session'], ['exam_year', 'Exam Year'], ['attempt_no', 'Attempt No.'], ['exam_type', 'Exam Type']]
    .map(([key, label]) => ({ key, label })).concat(report.columns.filter(column => column.key !== 'revaluated'), [{ key: 'result_view', label: 'Result View' }]);
}

function csvValue(key, value) {
  if (key.startsWith('semester_') && (value === null || value === undefined)) return '';
  if (key.endsWith('_pass_percentage')) return value === null || value === undefined ? '' : Number(value).toFixed(2);
  if (/^subject_\d+_(EX|IA|T)$/.test(key) && (value === null || value === undefined)) return '';
  if (['internal_marks', 'external_marks'].includes(key) && (value === null || value === undefined)) return '';
  return display(key, value);
}

function csvReportCell(key, value) {
  if ((/(^|_)(sgpa|cgpa)$/.test(key) || key === 'percentage' || key.endsWith('_pass_percentage')) && /^\d+(\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    if (Number.isFinite(number) && number < 1e21) {
      // Excel discards CSV number formatting; a numeric-only constant keeps two decimals.
      return `"=""${number.toFixed(2)}"""`;
    }
  }
  if (key === 'percentage' && value !== null && value !== undefined && value !== '') return csvCell(value);
  return csvCell(csvValue(key, value));
}

function* studentCsvLines(report) {
  const columns = exportColumns(report);
  const view = report.filters.mode === 'effective' ? 'Effective Result' : 'Original Result';
  yield [report.title.toUpperCase()];
  yield ['Program', 'MCA'];
  yield ['Batch', report.meta.batch.batch_name];
  yield ['USN', report.meta.student.usn];
  yield ['Student Name', report.meta.student.student_name];
  yield ['Result View', view];
  if (report.filters.mode === 'effective' && report.rows.some(row => Number(row.revaluated))) {
    yield ['Marks Basis', 'IA and External are original stored components; Total, Grade and Result may reflect approved revaluation.'];
  }
  for (const term of report.semesters) {
    yield [];
    yield [`SEMESTER ${term.semester}`];
    for (const sitting of term.sessions) {
      for (const attempt of sitting.attempts) {
        yield [];
        yield ['Exam Session', `${sitting.session.exam_session} ${sitting.session.exam_year}`];
        yield ['Attempt', attempt.result.attempt_no];
        yield ['Exam Type', attempt.result.exam_type];
        yield [];
        yield ['Sl. No.', ...columns.map(column => column.label)];
        for (let index = 0; index < attempt.subjects.length; index++) {
          const row = attempt.subjects[index];
          yield [index + 1, ...columns.map(column => csvValue(column.key, row[column.key]))];
        }
        if (!attempt.subjects.length) yield ['No subject results are stored for this attempt.'];
      }
    }
  }
  if (!report.semesters.length) { yield []; yield ['No persisted results match the selected student and filters.']; }
}

module.exports = { TITLES, TYPES, normalize, getOptions, getReport, prepare, fullRows, display, csvCell, filename, contextLines, exportColumns, csvValue, csvReportCell, studentCsvLines };
