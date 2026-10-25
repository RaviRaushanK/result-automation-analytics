'use strict';
const { sequelize } = require('../database/models');
const { QueryTypes } = require('sequelize');
const { effectiveEventJoin, expressions } = require('./revaluationOverlay');
const EFFECTIVE_EVENT_JOIN = effectiveEventJoin();
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
async function load(batchId, studentIds, mode = 'original', transaction) {
  const replacements = { batch_id: batchId, student_ids: studentIds };
  const courses = await select('SELECT * FROM academic_courses WHERE batch_id=:batch_id ORDER BY CAST(semester AS UNSIGNED),subject_code,course_id', replacements, transaction);
  if (!studentIds.length) return { courses, results: [], subjects: [] };
  const results = await select(`SELECT r.*,rs.semester,rs.exam_session,rs.exam_year,rs.exam_start_month,rs.exam_start_year,rs.exam_end_month,rs.exam_end_year FROM results r
    JOIN students st ON st.student_id=r.student_id AND st.deleted_at IS NULL
    JOIN exam_sessions rs ON rs.exam_session_id=r.exam_session_id AND rs.batch_id=st.batch_id
    WHERE rs.batch_id=:batch_id AND r.student_id IN (:student_ids)`, replacements, transaction);
  const effective = mode === 'effective';
  const outcome = expressions(mode);
  const subjects = await select(`SELECT sr.*,s.course_id,s.subject_code,s.credits,s.max_marks,
    s.exam_session_id AS subject_session_id,r.student_id,r.exam_session_id,r.attempt_no,r.exam_type,rs.semester,rs.exam_session,rs.exam_year,rs.exam_start_month,rs.exam_start_year,rs.exam_end_month,rs.exam_end_year,
    ${outcome.marks} AS outcome_marks,
    ${outcome.status} AS outcome_status,
    ${outcome.grade} AS outcome_grade
    FROM subject_results sr JOIN results r ON r.result_id=sr.result_id
    JOIN subjects s ON s.subject_id=sr.subject_id AND s.exam_session_id=r.exam_session_id
    JOIN students st ON st.student_id=r.student_id AND st.deleted_at IS NULL
    JOIN exam_sessions rs ON rs.exam_session_id=r.exam_session_id AND rs.batch_id=st.batch_id
    ${effective ? EFFECTIVE_EVENT_JOIN : ''}
    WHERE rs.batch_id=:batch_id AND r.student_id IN (:student_ids)`, replacements, transaction);
  return { courses, results, subjects };
}
async function priorCourses(batchId, usn, transaction) {
  return select(`SELECT DISTINCT COALESCE(sr.course_id_snapshot,s.course_id) AS course_id,
      rs.exam_session,rs.exam_year,rs.exam_start_month,rs.exam_start_year,rs.exam_end_month,rs.exam_end_year,r.exam_session_id,r.attempt_no
    FROM subject_results sr JOIN subjects s ON s.subject_id=sr.subject_id
    JOIN results r ON r.result_id=sr.result_id AND r.exam_session_id=s.exam_session_id
    JOIN exam_sessions rs ON rs.exam_session_id=r.exam_session_id
    JOIN students st ON st.student_id=r.student_id AND st.deleted_at IS NULL
    WHERE st.usn=:usn AND st.batch_id=:batch_id AND rs.batch_id=:batch_id`, { batch_id: batchId, usn }, transaction);
}
module.exports = { load, priorCourses };
