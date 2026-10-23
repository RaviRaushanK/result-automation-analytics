'use strict';
const { Result, ResultSession, SubjectResult, Subject, RevaluationResult } = require('../database/models');
const policy = require('./academicPolicy');

async function validationError(session, student, attempt, transaction, attemptedSubjects) {
  const semester = Number(session?.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 24) return 'Correct the academic semester of the selected result session before importing.';
  if (!student || String(student.batch_id) !== String(session.batch_id)) return 'Register or restore this student in the selected batch before importing results.';
  if (!Number.isSafeInteger(Number(attempt.attempt_no)) || Number(attempt.attempt_no) < 1 || !policy.EXAM_TYPES.includes(attempt.exam_type)) return 'Correct the examination attempt before importing results.';
  const needsOriginal = policy.isRetakeAttempt(attempt.exam_type) || Number(attempt.attempt_no) > 1;
  const lastRequired = needsOriginal ? semester : semester - 1;
  const cutoff = policy.period(session);
  if (cutoff === null) return 'Correct the examination month and year before checking previous result cards.';
  const results = await Result.findAll({
    where: { student_id: student.student_id },
    attributes: ['result_id', 'session_id', 'attempt_no', 'exam_type'],
    include: [
      { model: ResultSession, required: true, where: { batch_id: session.batch_id }, attributes: ['session_id', 'semester', 'exam_session', 'exam_year'] },
      { model: SubjectResult, required: false, attributes: ['subject_result_id','course_id_snapshot','result_status'], include: [
        { model: Subject, attributes: ['course_id'] },
        { model: RevaluationResult, as: 'Revaluations', required: false, where: { revaluation_status: 'approved', is_effective: true } }
      ] }
    ], transaction, ...(transaction ? { lock: true } : {})
  });
  const semesterResults = results.filter(result => Number(result.ResultSession?.semester) === semester);
  if (attempt.exam_type === 'BACKLOG' && semesterResults.some(result => policy.period(result.ResultSession) === cutoff)) {
    return 'BACKLOG must use a new examination period. An attempt for this student and Semester ' + semester +
      ' already uses ' + session.exam_session + ' ' + session.exam_year + '. Select or create the session in which the backlog was actually written.';
  }
  // Draft extractions and empty headers do not establish an uploaded card.
  const present = new Set();
  for (const result of results) {
    if (result.exam_type !== 'REGULAR' || !result.ResultSession || !result.SubjectResults?.length) continue;
    const previousSemester = Number(result.ResultSession.semester);
    const previousPeriod = policy.period(result.ResultSession);
    if (previousPeriod === null || previousPeriod > cutoff) continue;
    if (previousSemester === semester && !(previousPeriod < cutoff ||
      (String(result.session_id) === String(session.session_id) && Number(result.attempt_no) < Number(attempt.attempt_no)))) continue;
    present.add(previousSemester);
  }
  const missing = [];
  for (let previous = 1; previous <= lastRequired; previous++) if (!present.has(previous)) missing.push(previous);
  if (!missing.length) {
    if (attempt.exam_type === 'REGULAR') {
      if (Number(attempt.attempt_no) !== 1) return 'REGULAR must use attempt 1. Use BACKLOG for a later attempt.';
      if (semesterResults.some(result => result.exam_type === 'REGULAR')) {
        return 'The REGULAR result for this student and semester already exists. Use BACKLOG for a subsequent examination.';
      }
    } else if (attempt.exam_type === 'BACKLOG') {
      // Legacy records retain their stored numbers; new attempts continue beyond
      // both the highest stored number and the number of recorded sittings.
      const next = Math.max(1, semesterResults.length, ...semesterResults.map(result => Number(result.attempt_no) || 0)) + 1;
      if (Number(attempt.attempt_no) !== next) {
        return 'BACKLOG must use attempt ' + next + ' for this student and Semester ' + semester +
          '. Attempt numbers continue across examination sessions: REGULAR 1, BACKLOG 2, 3, and onward.';
      }
      if (semesterResults.some(result => policy.period(result.ResultSession) === null || policy.period(result.ResultSession) > cutoff)) {
        return 'Upload this semester\'s attempts in examination order. A later or undated attempt is already recorded.';
      }
      if (Array.isArray(attemptedSubjects)) {
        for (const subject of attemptedSubjects) {
          const earlier = semesterResults.flatMap(result => result.SubjectResults || []).filter(row =>
            String(row.course_id_snapshot ?? row.Subject?.course_id) === String(subject.course_id));
          if (!earlier.length) return subject.subject_code + ' cannot be uploaded as BACKLOG because no previous attempt for this academic course is recorded. Upload or verify the original result first.';
          const outcomes = earlier.map(row => {
            const effective = (row.Revaluations || []).filter(event => event.revaluation_status === 'approved' && (event.is_effective === true || Number(event.is_effective) === 1))
              .sort((a, b) => Number(b.revaluation_no) - Number(a.revaluation_no))[0];
            return effective?.revised_status || row.result_status;
          });
          if (outcomes.includes('pass')) return subject.subject_code + ' cannot be uploaded as BACKLOG because this academic course is already PASS/cleared in the recorded effective history. Select only eligible failed courses.';
          if (outcomes.some(status => status !== 'fail')) return 'The earlier outcome for ' + subject.subject_code + ' cannot be verified. Review the original course history before importing a backlog.';
        }
      }
    }
    return null;
  }
  const label = missing.length === 1 ? 'Semester ' + missing[0] : 'Semesters ' + missing.join(', ');
  const batch = session.Batch?.batch_name || 'batch ' + session.batch_id;
  return 'Previous result card missing: ' + label + ' for student ' + student.usn + ' in ' + batch +
    '. Upload the original result card(s) for the missing semester(s) before importing Semester ' + semester +
    (needsOriginal ? ' ' + attempt.exam_type + ' attempt ' + attempt.attempt_no : '') + '.';
}
module.exports = { validationError };
