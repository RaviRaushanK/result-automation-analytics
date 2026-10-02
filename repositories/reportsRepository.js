'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../database/models');

const select = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

// Same approved-effective, highest-event-number selection as Analytics.
const EFFECTIVE_EVENT_JOIN = `
  LEFT JOIN (
    SELECT e.revaluation_id, e.subject_result_id, e.revised_marks,
           e.revised_status, e.revised_grade
    FROM revaluation_results e
    INNER JOIN (
      SELECT subject_result_id, MAX(revaluation_no) AS max_no
      FROM revaluation_results
      WHERE is_effective = 1 AND revaluation_status = 'approved'
      GROUP BY subject_result_id
    ) pick ON pick.subject_result_id = e.subject_result_id AND pick.max_no = e.revaluation_no
    WHERE e.is_effective = 1 AND e.revaluation_status = 'approved'
  ) eff ON eff.subject_result_id = sr.subject_result_id
`;

async function batch(batchId) {
  return (await select('SELECT batch_id, batch_name, start_year, end_year FROM batches WHERE batch_id = :batchId AND deleted_at IS NULL', { batchId }))[0];
}

async function session(sessionId, batchId, semester) {
  return (await select(`SELECT session_id, batch_id, semester, exam_session, exam_year
    FROM result_sessions WHERE session_id = :sessionId AND batch_id = :batchId
    ${semester === undefined ? '' : 'AND semester = :semester'}`, { sessionId, batchId, semester }))[0];
}

async function student(studentId, batchId) {
  return (await select(`SELECT student_id, batch_id, usn, student_name FROM students
    WHERE student_id = :studentId AND batch_id = :batchId AND deleted_at IS NULL`, { studentId, batchId }))[0];
}

async function subject(subjectId, sessionId) {
  return (await select(`SELECT subject_id, subject_code, subject_name, credits, max_marks
    FROM subjects WHERE subject_id = :subjectId AND session_id = :sessionId`, { subjectId, sessionId }))[0];
}

async function options(scope, f) {
  switch (scope) {
    case 'batches': return select('SELECT batch_id, batch_name, start_year, end_year FROM batches WHERE deleted_at IS NULL ORDER BY start_year DESC, batch_name, batch_id');
    case 'students': return select(`SELECT student_id, usn, student_name FROM students
      WHERE batch_id = :batch_id AND deleted_at IS NULL ORDER BY usn, student_id`, f);
    case 'semesters': return select(`SELECT DISTINCT semester FROM result_sessions
      WHERE batch_id = :batch_id ORDER BY semester`, f);
    case 'sessions': return select(`SELECT session_id, semester, exam_session, exam_year FROM result_sessions
      WHERE batch_id = :batch_id AND semester = :semester ORDER BY exam_year DESC, exam_session, session_id`, f);
    case 'subjects': return select(`SELECT subject_id, subject_code, subject_name FROM subjects
      WHERE session_id = :session_id ORDER BY subject_code, subject_id`, f);
    case 'student-results': return select(`SELECT r.result_id, r.attempt_no, r.exam_type FROM results r
      INNER JOIN students st ON st.student_id = r.student_id AND st.deleted_at IS NULL
      INNER JOIN result_sessions rs ON rs.session_id = r.session_id AND rs.batch_id = st.batch_id
      WHERE r.student_id = :student_id AND r.session_id = :session_id ORDER BY r.attempt_no, r.result_id`, f);
    default: throw new Error('Unknown report option scope');
  }
}

function subjectRows(f) {
  const effective = f.mode === 'effective';
  return `SELECT sr.subject_result_id, r.result_id, r.student_id, st.usn, st.student_name,
    r.attempt_no, r.exam_type, sub.subject_code, sub.subject_name, sub.credits, sub.max_marks,
    ${effective ? 'COALESCE(eff.revised_marks, sr.marks)' : 'sr.marks'} AS marks,
    ${effective ? 'COALESCE(eff.revised_grade, sr.grade)' : 'sr.grade'} AS grade,
    ${effective ? 'COALESCE(eff.revised_status, sr.result_status)' : 'sr.result_status'} AS result_status,
    ${effective ? '(eff.revaluation_id IS NOT NULL)' : '0'} AS revaluated
    FROM subject_results sr
    INNER JOIN results r ON r.result_id = sr.result_id
    INNER JOIN students st ON st.student_id = r.student_id AND st.deleted_at IS NULL
    INNER JOIN result_sessions rs ON rs.session_id = r.session_id AND rs.batch_id = st.batch_id
    INNER JOIN batches b ON b.batch_id = rs.batch_id AND b.deleted_at IS NULL
    INNER JOIN subjects sub ON sub.subject_id = sr.subject_id AND sub.session_id = rs.session_id
    ${effective ? EFFECTIVE_EVENT_JOIN : ''}
    WHERE rs.session_id = :session_id AND rs.batch_id = :batch_id
    ${f.student_id ? 'AND r.student_id = :student_id AND r.attempt_no = :attempt_no' : ''}
    ${f.subject_id ? 'AND sub.subject_id = :subject_id' : ''}
    ${f.exam_type ? 'AND r.exam_type = :exam_type' : ''}`;
}

function dataset(type, f) {
  if (type === 'student' || type === 'subject') return subjectRows(f);
  if (type === 'class') {
    return `SELECT r.result_id, r.student_id, st.usn, st.student_name, r.attempt_no, r.exam_type,
      r.sgpa, r.cgpa, COALESCE(a.subjects, 0) AS subjects,
      COALESCE(a.passed, 0) AS passed, COALESCE(a.failed, 0) AS failed,
      ${f.mode === 'original' ? 'r.result_status' : `CASE WHEN a.failed > 0 THEN 'fail'
        WHEN a.subjects > 0 AND a.passed = a.subjects THEN 'pass' ELSE NULL END`} AS result_status
      FROM results r
      INNER JOIN students st ON st.student_id = r.student_id AND st.deleted_at IS NULL
      INNER JOIN result_sessions rs ON rs.session_id = r.session_id AND rs.batch_id = st.batch_id
      INNER JOIN batches b ON b.batch_id = rs.batch_id AND b.deleted_at IS NULL
      LEFT JOIN (SELECT q.result_id, COUNT(*) AS subjects,
        SUM(q.result_status = 'pass') AS passed, SUM(q.result_status = 'fail') AS failed
        FROM (${subjectRows(f)}) q GROUP BY q.result_id) a ON a.result_id = r.result_id
      WHERE rs.session_id = :session_id AND rs.batch_id = :batch_id
      ${f.exam_type ? 'AND r.exam_type = :exam_type' : ''}`;
  }
  return `SELECT rv.revaluation_id, r.student_id, st.usn, st.student_name, r.attempt_no, r.exam_type,
    sub.subject_code, sub.subject_name, rv.revaluation_no, rv.original_marks, rv.original_status,
    rv.revised_marks, rv.revised_grade, rv.revised_status, rv.revaluation_status,
    COALESCE(eff.revaluation_id = rv.revaluation_id, 0) AS is_effective, rv.reviewed_at
    FROM revaluation_results rv
    INNER JOIN subject_results sr ON sr.subject_result_id = rv.subject_result_id
    INNER JOIN results r ON r.result_id = sr.result_id
    INNER JOIN students st ON st.student_id = r.student_id AND st.deleted_at IS NULL
    INNER JOIN result_sessions rs ON rs.session_id = r.session_id AND rs.batch_id = st.batch_id
    INNER JOIN batches b ON b.batch_id = rs.batch_id AND b.deleted_at IS NULL
    INNER JOIN subjects sub ON sub.subject_id = sr.subject_id AND sub.session_id = rs.session_id
    ${EFFECTIVE_EVENT_JOIN}
    WHERE rs.session_id = :session_id AND rs.batch_id = :batch_id
    ${f.subject_id ? 'AND sub.subject_id = :subject_id' : ''}`;
}

function filtered(type, f) {
  return `SELECT d.* FROM (${dataset(type, f)}) d WHERE 1 = 1
    ${f.result_status && type !== 'revaluation' ? 'AND d.result_status = :result_status' : ''}
    ${f.revaluation_status && type === 'revaluation' ? 'AND d.revaluation_status = :revaluation_status' : ''}`;
}

async function summary(type, f) {
  const aggregate = type === 'revaluation'
    ? `SUM(q.revaluation_status = 'approved') AS approved, SUM(q.revaluation_status = 'pending') AS pending,
       SUM(q.revaluation_status = 'rejected') AS rejected, SUM(COALESCE(q.is_effective, 0)) AS effective`
    : `SUM(q.result_status = 'pass') AS passed, SUM(q.result_status = 'fail') AS failed,
       SUM(q.result_status IS NULL) AS unavailable,
       ${type === 'class' ? 'COUNT(DISTINCT q.student_id) AS students' : 'AVG(q.marks) AS average_marks, MIN(q.marks) AS lowest_marks, MAX(q.marks) AS highest_marks'}`;
  return (await select(`SELECT COUNT(*) AS total_rows, ${aggregate} FROM (${filtered(type, f)}) q`, f))[0];
}

async function rows(type, f, limit, offset) {
  const order = type === 'student' ? 'q.subject_code, q.subject_result_id'
    : type === 'revaluation' ? 'q.usn, q.attempt_no, q.subject_code, q.revaluation_no, q.revaluation_id'
      : type === 'class' ? 'q.usn, q.attempt_no, q.result_id' : 'q.usn, q.attempt_no, q.subject_result_id';
  return select(`SELECT q.* FROM (${filtered(type, f)}) q ORDER BY ${order} LIMIT :limit OFFSET :offset`, { ...f, limit, offset });
}

async function resultHeader(f) {
  return (await select(`SELECT r.result_id, r.attempt_no, r.exam_type, r.sgpa, r.cgpa,
    r.result_status, r.failed_subject_count FROM results r
    INNER JOIN students st ON st.student_id = r.student_id AND st.deleted_at IS NULL AND st.batch_id = :batch_id
    INNER JOIN result_sessions rs ON rs.session_id = r.session_id AND rs.batch_id = st.batch_id
    WHERE r.student_id = :student_id AND r.session_id = :session_id AND r.attempt_no = :attempt_no`, f))[0];
}

module.exports = { batch, session, student, subject, options, summary, rows, resultHeader };
