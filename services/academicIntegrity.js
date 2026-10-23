'use strict';
const crypto = require('node:crypto');
const policy = require('./academicPolicy');
const examPeriod = require('../public/js/exam-period');
const digest = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value) ?? 'null').digest('hex');
const present = value => value !== null && value !== undefined && value !== '';
function mark(value) {
  if (!present(value)) return { present: false, invalid: false, value: null };
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !/^\d+$/.test(value.trim()))
    || !Number.isSafeInteger(Number(value)) || Number(value) < 0 || Object.is(value, -0)) return { present: true, invalid: true, value: null };
  return { present: true, invalid: false, value: Number(value) };
}
const code = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const usn = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
function claims(ex = {}) {
  const text = ex.raw_text || ex.rawText || '';
  const unique = values => [...new Set(values.filter(present).map(value => String(value).trim().toUpperCase()))];
  const labeled = (expression, group = 1) => [...text.matchAll(expression)].map(match => match[group]);
  const printedPeriod = examPeriod.parseText(text);
  return {
    usns: unique([...(ex.usns || []), ex.student?.usnRaw || ex.student?.usn, ex.student_candidates?.usn_raw || ex.student_candidates?.usn,
      ...labeled(/\bUSN\s*[:=-]\s*([A-Z0-9/-]+)/gi)]),
    semesters: unique([...(ex.semesters || []), ex.semester_candidate ?? ex.semester, ...labeled(/\bSEMESTER\s*[:=-]\s*(\d+)\b/gi)]),
    periods: [...(ex.periods || []), ...(examPeriod.normalize(ex) ? [examPeriod.normalize(ex)] : []), ...(printedPeriod ? [printedPeriod] : [])],
    attempts: unique([...(ex.attempts || []), ex.attempt_no, ...labeled(/\bATTEMPT(?:\s+NO\.?)?\s*[:=-]\s*(\d+)\b/gi)]),
    types: unique([...(ex.types || []), ex.exam_type, ...labeled(/\bEXAM\s+TYPE\s*[:=-]\s*(REGULAR|BACKLOG|SUPPLEMENTARY|REPEAT)\b/gi)])
  };
}
function contextChecks(ex, target) {
  const evidence = claims(ex), checks = [];
  function check(field, values, expected, normalize = String) {
    checks.push({ field, status: !values.length ? 'NOT PRESENT IN DOCUMENT'
      : values.every(value => normalize(value) === normalize(expected)) ? 'MATCH' : 'MISMATCH',
    document: values.join(', '), expected: String(expected ?? '') });
  }
  check('USN', evidence.usns, target.usn, usn);
  check('Semester', evidence.semesters, target.semester, value => String(Number(value)));
  check('Examination period', evidence.periods.map(policy.periodKey), policy.periodKey(target));
  check('Attempt', evidence.attempts, target.attempt_no, value => String(Number(value)));
  check('Exam type', evidence.types, target.exam_type);
  return checks;
}
function duplicateRows(rows = []) {
  const seen = new Set(), conflicts = [];
  for (const row of rows) {
    const key = code(row.subjectCode || row.subject_code || row.ocr_subject_code);
    if (key && seen.has(key)) conflicts.push('Multiple extracted rows identify ' + key + '. Re-extract a clear document; no arbitrary row can be imported.');
    seen.add(key);
  }
  return [...new Set(conflicts)];
}
function originalDocumentErrors(saved, session, student, attempt, verified, mixedVerified) {
  const checks = contextChecks(saved.document_evidence || {}, { batch_id: session.batch_id, semester: session.semester,
    exam_start_month: session.exam_start_month, exam_start_year: session.exam_start_year,
    exam_end_month: session.exam_end_month, exam_end_year: session.exam_end_year,
    exam_session: session.exam_session, exam_year: session.exam_year,
    usn: student.usn, attempt_no: attempt.attempt_no, exam_type: attempt.exam_type });
  const mixed = saved.excluded_subjects?.length && mixedVerified;
  const mismatches = checks.filter(check => check.status === 'MISMATCH' && !(mixed && ['Semester','Attempt','Exam type'].includes(check.field)));
  const errors = mismatches.map(check => `Document ${check.field} ${check.document} does not match selected ${check.expected}. Select the correct student/examination session or replace the document.`);
  for (const check of checks.filter(check => !['Attempt','Exam type'].includes(check.field))) {
    if (check.status === 'NOT PRESENT IN DOCUMENT' && !acknowledged(verified, check.field)) errors.push(missingVerificationMessage(check.field));
  }
  return errors;
}
const verificationKeys = { USN: 'usn', Semester: 'semester', 'Examination period': 'period', 'Old external marks': 'old_marks', 'Old external result': 'old_status' };
function missingVerificationMessage(field) {
  if (field === 'USN') return 'The student identity could not be verified from the document. Please confirm the USN against the original marks card.';
  return `The ${field.toLowerCase()} could not be verified from the document. Please confirm it against the original marks card.`;
}
function acknowledged(values, field) { return values === true || values?.[verificationKeys[field]] === true; }
function acknowledgments(body = {}) { return Object.fromEntries(Object.values(verificationKeys).map(key => [key, body['verify_' + key] === '1'])); }
function summary(ex, target) { return contextChecks(ex, target).map(check => ({ ...check,
  key: verificationKeys[check.field], derived: ['Attempt','Exam type'].includes(check.field) && check.status === 'NOT PRESENT IN DOCUMENT' })); }
module.exports = { digest, present, mark, code, usn, claims, contextChecks, duplicateRows, originalDocumentErrors, acknowledged, acknowledgments, summary };
