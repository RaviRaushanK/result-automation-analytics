'use strict';
const repository = require('../repositories/academicRepository');
const policy = require('./academicPolicy');
const truth = value => value === true || Number(value) === 1;
const present = value => value !== null && value !== undefined;
function semesterOutcome(data, studentId, semester, cutoff = Infinity) {
  const allCourses = data.courses.filter(c => String(c.semester) === String(semester) && c.status === 'active');
  const required = allCourses.filter(c => truth(c.is_required));
  const rosterKnown = required.length > 0 && allCourses.every(c => truth(c.roster_verified));
  const results = data.results.filter(r => String(r.student_id) === String(studentId) && String(r.semester) === String(semester)
    && (policy.period(r) === null || policy.period(r) <= cutoff)).sort(policy.order);
  const subjects = data.subjects.filter(s => String(s.student_id) === String(studentId) && String(s.semester) === String(semester)
    && (policy.period(s) === null || policy.period(s) <= cutoff));
  const badChronology = results.some(r => policy.period(r) === null);
  const regular = results.filter(r => policy.isRegularAttempt(r.exam_type));
  const first = regular[0] || null;
  const ambiguousRegular = first && regular.some(r => r !== first && policy.period(r) === policy.period(first)
    && (String(r.session_id) !== String(first.session_id) || Number(r.attempt_no) === Number(first.attempt_no)));
  // Several regular headers in one period cannot establish the first sitting.
  const firstKnown = rosterKnown && !badChronology && first
    && !results.some(r => policy.isRetakeAttempt(r.exam_type) && (policy.period(r) < policy.period(first)
      || policy.period(r) === policy.period(first) && String(r.session_id) === String(first.session_id) && Number(r.attempt_no) < Number(first.attempt_no)))
    && !ambiguousRegular;
  const firstRows = first ? subjects.filter(s => String(s.result_id) === String(first.result_id)) : [];
  const firstByCourse = new Map(firstRows.map(s => [String(s.course_id_snapshot ?? s.course_id), s]));
  const completeFirst = firstKnown && firstByCourse.size === firstRows.length && firstRows.every(s => present(s.course_id_snapshot ?? s.course_id))
    && required.every(c => ['pass','fail'].includes(firstByCourse.get(String(c.course_id))?.outcome_status));
  const firstAttempt = completeFirst ? (required.every(c => firstByCourse.get(String(c.course_id)).outcome_status === 'pass') ? 'P' : 'F') : '-';
  const courses = required.map(course => {
    const attempts = subjects.filter(s => String(s.course_id_snapshot ?? s.course_id) === String(course.course_id)).sort(policy.order);
    const ties = attempts.some((a, i) => i && policy.period(a) === policy.period(attempts[i-1])
      && (String(a.session_id) !== String(attempts[i-1].session_id) || Number(a.attempt_no) === Number(attempts[i-1].attempt_no)));
    const passing = attempts.find(a => a.outcome_status === 'pass');
    const unknown = !rosterKnown || badChronology || ambiguousRegular || ties || !attempts.length || attempts.some(a => !['pass','fail'].includes(a.outcome_status));
    const accepted = passing || attempts.at(-1) || null;
    const cleared = unknown ? null : Boolean(passing);
    return { courseId: course.course_id, subjectCode: course.subject_code, definition: course, attempts,
      firstAttempt: attempts[0] || null, latestAttempt: attempts.at(-1) || null, acceptedAttempt: accepted,
      cleared, clearedOnAttempt: cleared ? passing.result_id : null,
      clearedViaRetake: cleared ? policy.isRetakeAttempt(passing.exam_type) : null,
      effectiveStatus: cleared === null ? null : cleared ? 'pass' : 'fail' };
  });
  const cleared = !rosterKnown || courses.some(c => c.cleared === null) ? null : courses.every(c => c.cleared);
  const retakes = subjects.filter(s => policy.isRetakeAttempt(s.exam_type) && first && policy.order(s, first) > 0);
  let supplementaryPass = '-';
  if (firstAttempt === 'F' && retakes.length && cleared !== null) {
    const correctedFailure = courses.some(c => firstByCourse.get(String(c.courseId))?.outcome_status === 'fail'
      && c.attempts.some(a => a.outcome_status === 'pass' && policy.isRetakeAttempt(a.exam_type) && policy.order(a, first) > 0));
    supplementaryPass = cleared && correctedFailure ? 'P' : !cleared ? 'F' : '-';
  }
  return { semester, courses, rosterKnown, firstRegularResult: firstKnown ? first : null, firstAttempt, supplementaryPass, cleared,
    withoutBacklog: firstAttempt === 'P' ? 'Y' : firstAttempt === 'F' && cleared !== null ? 'N' : '-',
    withBacklog: firstAttempt === '-' ? '-' : firstAttempt === 'F' && cleared === true ? 'Y' : cleared === false || firstAttempt === 'P' ? 'N' : '-' };
}
function academicYearOutcome(data, studentId, semesters, cutoff = Infinity) {
  const outcomes = semesters.map(semester => semesterOutcome(data, studentId, semester, cutoff));
  const unknown = { withBacklog: '-', withoutBacklog: '-', cleared: null };
  if (!outcomes.length || outcomes.some(o => o.firstAttempt === '-' || o.cleared === null)) return unknown;
  if (outcomes.some(o => !o.cleared)) return { withBacklog: 'N', withoutBacklog: 'N', cleared: false };
  if (outcomes.every(o => o.firstAttempt === 'P')) return { withBacklog: 'N', withoutBacklog: 'Y', cleared: true };
  // Completion after a later REGULAR pass alone is not proven retake clearance.
  if (outcomes.filter(o => o.firstAttempt === 'F').every(o => o.supplementaryPass === 'P' && o.courses.some(c => c.clearedViaRetake === true))) {
    return { withBacklog: 'Y', withoutBacklog: 'N', cleared: true };
  }
  return { ...unknown, cleared: true };
}
function cumulative(data, studentId, throughSemester, cutoff = Infinity) {
  const last = Number(throughSemester);
  if (!Number.isInteger(last) || last < 1 || last > 24) return null;
  let points = 0, credits = 0;
  for (let semester = 1; semester <= last; semester++) {
    const outcome = semesterOutcome(data, studentId, String(semester), cutoff);
    if (!outcome.rosterKnown || outcome.firstAttempt === '-' || !outcome.courses.length) return null;
    for (const course of outcome.courses) {
      const accepted = course.acceptedAttempt;
      if (course.cleared === null || !accepted || accepted.grading_scheme_version !== policy.SCHEME
        || !present(accepted.grade_point) || !present(accepted.credits_snapshot)
        || Number(accepted.grade_point) !== policy.POINTS[accepted.grade]
        || Number(accepted.credits_snapshot) !== Number(course.definition.credits)
        || Number(accepted.credits_snapshot) < 0) return null;
      points += Number(accepted.grade_point) * Number(accepted.credits_snapshot);
      credits += Number(accepted.credits_snapshot);
    }
  }
  return credits ? Number((points / credits).toFixed(2)) : null;
}
async function calculateCumulative(batchId, studentId, semester, period, transaction) {
  const data = await repository.load(batchId, [studentId], 'original', transaction);
  return cumulative(data, studentId, semester, period);
}
async function retakeWarnings(session, usn, subjects, transaction, attemptNo) {
  const current = policy.period(session);
  const history = await repository.priorCourses(session.batch_id, usn, transaction);
  const missing = subjects.filter(subject => !history.some(row => String(row.course_id) === String(subject.course_id)
    && current !== null && policy.period(row) !== null && (policy.period(row) < current
      || policy.period(row) === current && String(row.session_id) === String(session.session_id) && Number(row.attempt_no) < Number(attemptNo))));
  return missing.length ? [`Prior course history could not be verified for ${missing.map(s => s.subject_code).join(', ')}. Review the earlier results before confirming this retake; clearance will remain unknown where history is incomplete.`] : [];
}
module.exports = { semesterOutcome, academicYearOutcome, cumulative, calculateCumulative, retakeWarnings, load: repository.load };
