'use strict';
const { sequelize } = require('../database/models');
const { QueryTypes } = require('sequelize');
const { EFFECTIVE_EVENT_JOIN } = require('./reportsRepository');
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
async function load(batchId, studentIds, mode = 'original', transaction) {
  const replacements = { batch_id: batchId, student_ids: studentIds };
  const courses = await select('SELECT * FROM academic_courses WHERE batch_id=:batch_id ORDER BY CAST(semester AS UNSIGNED),subject_code,course_id', replacements, transaction);
  if (!studentIds.length) return { courses, results: [], subjects: [] };
  const results = await select(`SELECT r.*,rs.semester,rs.exam_session,rs.exam_year FROM results r
    JOIN students st ON st.student_id=r.student_id AND st.deleted_at IS NULL
    JOIN result_sessions rs ON rs.session_id=r.session_id AND rs.batch_id=st.batch_id
    WHERE rs.batch_id=:batch_id AND r.student_id IN (:student_ids)`, replacements, transaction);
  const effective = mode === 'effective';
  const subjects = await select(`SELECT sr.*,s.course_id,s.subject_code,s.credits,s.max_marks,
    s.session_id AS subject_session_id,r.student_id,r.session_id,r.attempt_no,r.exam_type,rs.semester,rs.exam_session,rs.exam_year,
    ${effective ? 'COALESCE(eff.revised_marks,sr.marks)' : 'sr.marks'} AS outcome_marks,
    ${effective ? 'COALESCE(eff.revised_status,sr.result_status)' : 'sr.result_status'} AS outcome_status,
    ${effective ? 'COALESCE(eff.revised_grade,sr.grade)' : 'sr.grade'} AS outcome_grade
    FROM subject_results sr JOIN results r ON r.result_id=sr.result_id
    JOIN subjects s ON s.subject_id=sr.subject_id AND s.session_id=r.session_id
    JOIN students st ON st.student_id=r.student_id AND st.deleted_at IS NULL
    JOIN result_sessions rs ON rs.session_id=r.session_id AND rs.batch_id=st.batch_id
    ${effective ? EFFECTIVE_EVENT_JOIN : ''}
    WHERE rs.batch_id=:batch_id AND r.student_id IN (:student_ids)`, replacements, transaction);
  return { courses, results, subjects };
}
async function priorCourses(batchId, usn, transaction) {
  return select(`SELECT DISTINCT COALESCE(sr.course_id_snapshot,s.course_id) AS course_id,
      rs.exam_session,rs.exam_year,r.session_id,r.attempt_no
    FROM subject_results sr JOIN subjects s ON s.subject_id=sr.subject_id
    JOIN results r ON r.result_id=sr.result_id AND r.session_id=s.session_id
    JOIN result_sessions rs ON rs.session_id=r.session_id
    JOIN students st ON st.student_id=r.student_id AND st.deleted_at IS NULL
    WHERE st.usn=:usn AND st.batch_id=:batch_id AND rs.batch_id=:batch_id`, { batch_id: batchId, usn }, transaction);
}
module.exports = { load, priorCourses };
