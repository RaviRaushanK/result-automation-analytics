'use strict';
const { Result, ResultSession, SubjectResult } = require('../database/models');
const policy = require('./academicPolicy');

async function validationError(session, student, attempt, transaction) {
  const semester = Number(session?.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 24) return 'Correct the academic semester of the selected result session before importing.';
  if (!student || String(student.batch_id) !== String(session.batch_id)) return 'Register or restore this student in the selected batch before importing results.';
  if (!Number.isSafeInteger(Number(attempt.attempt_no)) || Number(attempt.attempt_no) < 1 || !policy.EXAM_TYPES.includes(attempt.exam_type)) return 'Correct the examination attempt before importing results.';
  const needsOriginal = policy.isRetakeAttempt(attempt.exam_type) || Number(attempt.attempt_no) > 1;
  const lastRequired = needsOriginal ? semester : semester - 1;
  if (lastRequired === 0) return null;
  const cutoff = policy.period(session);
  if (cutoff === null) return 'Correct the examination month and year before checking previous result cards.';
  const results = await Result.findAll({
    where: { student_id: student.student_id, exam_type: 'REGULAR' },
    attributes: ['result_id', 'session_id', 'attempt_no'],
    include: [
      { model: ResultSession, required: true, where: { batch_id: session.batch_id }, attributes: ['session_id', 'semester', 'exam_session', 'exam_year'] },
      { model: SubjectResult, required: true, attributes: ['subject_result_id'] }
    ], transaction
  });
  // Draft extractions and empty headers do not establish an uploaded card.
  const present = new Set();
  for (const result of results) {
    if (!result.ResultSession || !result.SubjectResults?.length) continue;
    const previousSemester = Number(result.ResultSession.semester);
    const previousPeriod = policy.period(result.ResultSession);
    if (previousPeriod === null || previousPeriod > cutoff) continue;
    if (previousSemester === semester && !(previousPeriod < cutoff ||
      (String(result.session_id) === String(session.session_id) && Number(result.attempt_no) < Number(attempt.attempt_no)))) continue;
    present.add(previousSemester);
  }
  const missing = [];
  for (let previous = 1; previous <= lastRequired; previous++) if (!present.has(previous)) missing.push(previous);
  if (!missing.length) return null;
  const label = missing.length === 1 ? 'Semester ' + missing[0] : 'Semesters ' + missing.join(', ');
  const batch = session.Batch?.batch_name || 'batch ' + session.batch_id;
  return 'Previous result card missing: ' + label + ' for student ' + student.usn + ' in ' + batch +
    '. Upload the original result card(s) for the missing semester(s) before importing Semester ' + semester +
    (needsOriginal ? ' ' + attempt.exam_type + ' attempt ' + attempt.attempt_no : '') + '.';
}
module.exports = { validationError };
