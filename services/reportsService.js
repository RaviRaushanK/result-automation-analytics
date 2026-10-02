'use strict';

const repository = require('../repositories/reportsRepository');
const TYPES = ['student', 'class', 'subject', 'revaluation'];
const TITLES = { student: 'Student Result Report', class: 'Class Result Report', subject: 'Subject Result Report', revaluation: 'Revaluation Report' };

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
    session_id: integer(query.session_id, 'Result session', true),
    semester: semester(query.semester),
    student_id: integer(query.student_id, 'Student', type === 'student'),
    subject_id: integer(query.subject_id, 'Subject', type === 'subject'),
    attempt_no: integer(query.attempt_no, 'Attempt'),
    mode: choice(query.mode, 'Result view', ['original', 'effective'], 'effective'),
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
  if (type === 'class' && (f.subject_id || f.revaluation_status)) invalid('Unsupported Class Result filter.');
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
  if (type === 'student') {
    meta.student = await repository.student(f.student_id, f.batch_id);
    if (!meta.student) invalid('Student does not belong to the selected batch.', 404);
    const attempts = await repository.options('student-results', f);
    if (!f.attempt_no) {
      if (attempts.length > 1) invalid('Select an attempt for this student and session.');
      if (!attempts.length) invalid('No result exists for this student and session.', 404);
      f.attempt_no = Number(attempts[0].attempt_no);
    }
    meta.result = await repository.resultHeader(f);
    if (!meta.result) invalid('The selected result attempt was not found.', 404);
  }
  return meta;
}

async function getOptions(scope, query = {}) {
  const f = {};
  if (scope === 'batches') return repository.options(scope, f);
  if (!['students', 'semesters', 'sessions', 'subjects', 'student-results'].includes(scope)) invalid('Unknown filter.', 404);
  f.batch_id = integer(query.batch_id, 'Batch', true);
  await requireBatch(f.batch_id);
  if (scope === 'sessions') f.semester = semester(query.semester);
  if (scope === 'subjects' || scope === 'student-results') {
    f.session_id = integer(query.session_id, 'Result session', true);
    if (!await repository.session(f.session_id, f.batch_id)) invalid('Result session does not belong to the selected batch.', 404);
  }
  if (scope === 'student-results') {
    f.student_id = integer(query.student_id, 'Student', true);
    if (!await repository.student(f.student_id, f.batch_id)) invalid('Student does not belong to the selected batch.', 404);
  }
  return repository.options(scope, f);
}

function columns(type, mode) {
  const identity = [['usn', 'USN'], ['student_name', 'Student Name']];
  const attempt = [['attempt_no', 'Attempt No.'], ['exam_type', 'Exam Type']];
  const outcome = [['marks', 'Marks'], ['max_marks', 'Max Marks'], ['grade', 'Grade'], ['result_status', 'Result']];
  let pairs;
  if (type === 'student') pairs = [['subject_code', 'Subject Code'], ['subject_name', 'Subject Name'], ['credits', 'Credits'], ...outcome];
  if (type === 'class') pairs = [...identity, ...attempt, ['subjects', 'Subjects'], ['passed', 'Passed'], ['failed', 'Failed'], ['result_status', 'Result'], ...(mode === 'original' ? [['sgpa', 'SGPA'], ['cgpa', 'CGPA']] : [])];
  if (type === 'subject') pairs = [...identity, ...attempt, ...outcome];
  if (type === 'revaluation') pairs = [...identity, ...attempt, ['subject_code', 'Subject Code'], ['subject_name', 'Subject Name'], ['revaluation_no', 'Revaluation No.'], ['original_marks', 'Original Marks'], ['original_status', 'Original Result'], ['revised_marks', 'Revised Marks'], ['revised_grade', 'Revised Grade'], ['revised_status', 'Revised Result'], ['revaluation_status', 'Revaluation Status'], ['is_effective', 'Effective'], ['reviewed_at', 'Reviewed At']];
  if (mode === 'effective' && type !== 'class' && type !== 'revaluation') pairs.push(['revaluated', 'Revaluated']);
  return pairs.map(([key, label]) => ({ key, label }));
}

function metrics(type, summary, meta, mode) {
  const s = Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value === null ? null : Number(value)]));
  const total = s.total_rows || 0;
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
  const meta = await context(type, filters);
  const summary = await repository.summary(type, filters);
  const totalRows = Number(summary.total_rows) || 0;
  const pageSize = type === 'student' ? Math.max(totalRows, 1) : filters.pageSize;
  const totalPages = Math.ceil(totalRows / pageSize);
  const page = Math.min(filters.page, Math.max(totalPages, 1));
  const report = { type, title: TITLES[type], filters, meta, metrics: metrics(type, summary, meta, filters.mode),
    columns: columns(type, filters.mode), pagination: { page, pageSize, totalRows, totalPages }, generatedAt: new Date().toISOString() };
  report.context = contextLines(report);
  return report;
}

async function getReport(type, query) {
  const report = await prepare(type, query);
  const { page, pageSize } = report.pagination;
  report.rows = await repository.rows(type, report.filters, pageSize, (page - 1) * pageSize);
  return report;
}

async function* fullRows(report) {
  // Full exports are fetched in chunks without the preview's page-size cap.
  for (let offset = 0; ; offset += 1000) {
    const rows = await repository.rows(report.type, report.filters, 1000, offset);
    for (const row of rows) yield row;
    if (rows.length < 1000) break;
  }
}

function display(key, value) {
  if (value === null || value === undefined || value === '') return '-';
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
  const prefix = report.type === 'revaluation' ? 'revaluation-report' : `${report.type}-result`;
  const suffix = report.type === 'revaluation' ? '' : `_${report.filters.mode}`;
  const safe = `${prefix}_${component}_${report.meta.session.semester}_${report.meta.session.exam_session}_${report.meta.session.exam_year}${suffix}`
    .replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 180);
  return `${safe}.csv`;
}

function contextLines(report) {
  const { batch, session, student, subject, result } = report.meta;
  const lines = [['Programme', 'MCA'], ['Batch', batch.batch_name], ['Semester', session.semester], ['Result Session', `${session.exam_session} ${session.exam_year}`]];
  if (student) lines.push(['USN', student.usn], ['Student Name', student.student_name], ['Attempt', `${result.attempt_no} - ${result.exam_type}`]);
  if (subject) lines.push(['Subject', `${subject.subject_code} - ${subject.subject_name}`], ['Credits', subject.credits], ['Max Marks', subject.max_marks]);
  if (report.type !== 'revaluation') lines.push(['Result View', `${report.filters.mode === 'effective' ? 'Effective' : 'Original'} Result`]);
  if (report.filters.exam_type) lines.push(['Exam Type', report.filters.exam_type]);
  if (report.filters.result_status) lines.push(['Result Status', report.filters.result_status.toUpperCase()]);
  if (report.filters.revaluation_status) lines.push(['Revaluation Status', report.filters.revaluation_status.toUpperCase()]);
  lines.push(['Generated At', report.generatedAt]);
  return lines;
}

module.exports = { TITLES, TYPES, normalize, getOptions, getReport, prepare, fullRows, display, csvCell, filename, contextLines };
