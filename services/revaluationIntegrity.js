'use strict';
const integrity = require('./academicIntegrity');
const target = result => ({ usn: result.Student?.usn, semester: result.ResultSession?.semester,
  exam_start_month: result.ResultSession?.exam_start_month, exam_start_year: result.ResultSession?.exam_start_year,
  exam_end_month: result.ResultSession?.exam_end_month, exam_end_year: result.ResultSession?.exam_end_year,
  exam_session: result.ResultSession?.exam_session, exam_year: result.ResultSession?.exam_year,
  attempt_no: result.attempt_no, exam_type: result.exam_type });
function checks(saved, result) {
  const list = integrity.summary(saved.ocr || {}, target(result));
  const rows = saved.ocr?.subjects || [];
  if (rows.some(ev => ev.oldResult)) list.push({ field: 'Old external result', key: 'old_status', status: 'UNVERIFIED', document: '', expected: 'Original component status is not stored separately', derived: false });
  if (rows.some(ev => integrity.present(ev.oldMarks) && !integrity.present(result.SubjectResults.find(sr => Number(sr.subject_result_id) === Number(ev.subject_result_id))?.external_marks))) list.push({ field: 'Old external marks', key: 'old_marks', status: 'UNVERIFIED', document: '', expected: 'Original external marks are unavailable', derived: false });
  for (const ev of rows) {
    const sr = result.SubjectResults.find(sr => Number(sr.subject_result_id) === Number(ev.subject_result_id));
    if (!sr) continue;
    const documentCode = ev.subjectCode || ev.ocr_subject_code;
    if (documentCode) list.push({ field: 'Subject ' + documentCode, status: integrity.code(documentCode) === integrity.code(sr.Subject?.subject_code) ? 'MATCH' : 'MISMATCH', document: documentCode, expected: sr.Subject?.subject_code, derived: false });
    if (integrity.present(ev.oldMarks) && integrity.present(sr.external_marks)) list.push({ field: 'Old external marks ' + (documentCode || ''), status: Number(ev.oldMarks) === Number(sr.external_marks) ? 'MATCH' : 'MISMATCH', document: ev.oldMarks, expected: sr.external_marks, derived: false });
  }
  return list;
}
function snapshot(result) {
  return { student_id: result.student_id, usn: result.Student?.usn, session_id: result.session_id,
    semester: result.ResultSession?.semester,
    exam_start_month: result.ResultSession?.exam_start_month, exam_start_year: result.ResultSession?.exam_start_year,
    exam_end_month: result.ResultSession?.exam_end_month, exam_end_year: result.ResultSession?.exam_end_year,
    exam_session: result.ResultSession?.exam_session, exam_year: result.ResultSession?.exam_year,
    attempt_no: result.attempt_no, exam_type: result.exam_type,
    subjects: (result.SubjectResults || []).map(sr => ({ id: sr.subject_result_id, subject_id: sr.subject_id, marks: sr.marks,
      internal: sr.internal_marks, external: sr.external_marks,
      status: sr.result_status, grade: sr.grade, subject: sr.Subject?.toJSON ? sr.Subject.toJSON() : sr.Subject })).sort((a, b) => a.id - b.id) };
}
function verify(saved, result, proposals = [], acknowledged = false) {
  const errors = [], documentChecks = checks(saved, result);
  if (!result.Student || !integrity.usn(result.Student.usn) || !result.ResultSession) errors.push('The authoritative original student or examination context is unavailable. Restore or verify the registered student and select the correct existing attempt before revaluation.');
  if (result.Student?.batch_id !== undefined && result.ResultSession?.batch_id !== undefined
    && String(result.Student.batch_id) !== String(result.ResultSession.batch_id)) errors.push('The original student and examination batch do not match. Resolve the historical association through a controlled academic workflow before revaluation.');
  for (const check of documentChecks.filter(check => check.status === 'MISMATCH')) errors.push(
    `The revaluation document identifies ${check.field} ${check.document}, but the selected result identifies ${check.expected}. Approval is blocked. Select the correct attempt or replace the document.`);
  for (const check of documentChecks.filter(check => !check.derived)) {
    if (['NOT PRESENT IN DOCUMENT','UNVERIFIED'].includes(check.status) && !integrity.acknowledged(acknowledged, check.field)) errors.push(`Verify ${check.field} against the original card because authoritative comparison is unavailable.`);
  }
  errors.push(...integrity.duplicateRows(saved.ocr?.subjects));
  errors.push(...(saved.ocr?.integrity_conflicts || []));
  if (eventReferences(saved).length > 1) errors.push('The document identifies conflicting revaluation event references. Re-extract the correct event document.');
  for (const p of proposals.filter(p => p.decision === 'accept')) {
    const id = Number(p.bound_to_srid || p.subject_result_id);
    const sr = result.SubjectResults.find(sr => Number(sr.subject_result_id) === id);
    if (!sr) { errors.push('The subject does not belong to the selected existing attempt.'); continue; }
    if (!sr.Subject || !sr.Subject.subject_code) { errors.push('The authoritative original subject offering is unavailable. Select an existing subject from the correct attempt.'); continue; }
    if (String(sr.result_id) !== String(result.result_id)
      || sr.Subject?.session_id !== undefined && String(sr.Subject.session_id) !== String(result.session_id)) errors.push('The original subject offering does not belong to this exact examination attempt.');
    const rows = saved.ocr?.subjects || [];
    const ev = p.source === 'UNMATCHED_OCR' ? { ocr_subject_code: p.ocr_subject_code }
      : rows.find(row => Number(row.subject_result_id) === Number(p.subject_result_id))
        || rows.find(row => integrity.code(row.subjectCode || row.ocr_subject_code) === integrity.code(sr.Subject?.subject_code));
    if (!ev && rows.some(row => row.subjectCode || row.ocr_subject_code)) errors.push('The document identifies other subjects but does not identify the accepted subject. Re-extract the correct subject card before approving this manual row.');
    if (!ev) continue; // Missing OCR evidence remains explicitly verified manual entry.
    const documentCode = ev.subjectCode || ev.ocr_subject_code;
    if (documentCode && result.SubjectResults.filter(row => integrity.code(row.Subject?.subject_code) === integrity.code(documentCode)).length !== 1) errors.push('The document subject cannot be uniquely identified in this attempt. Resolve its exact course identity before approval.');
    if (documentCode && integrity.code(documentCode) !== integrity.code(sr.Subject?.subject_code)) errors.push('The document subject ' + documentCode + ' does not match the selected original subject. Replace the document or select its exact existing attempt.');
    if (integrity.present(ev.oldMarks)) {
      const old = integrity.mark(ev.oldMarks);
      // Nine-column oldMarks is the old external mark, not the total.
      if (old.invalid || (integrity.present(sr.external_marks) && old.value !== Number(sr.external_marks))) errors.push('Document old external marks conflict with the original SubjectResult. Original marks cannot be rewritten; select the correct attempt.');
      if (!integrity.present(sr.external_marks) && !integrity.acknowledged(acknowledged, 'Old external marks')) errors.push('Original external marks are unavailable in this legacy record. Verify them against the original card before approval.');
    }
    // oldResult accompanies oldMarks in the external-component columns. The
    // original external result status is not stored, so comparing it with the
    // overall SR status would invent a component-pass rule and reject valid cards.
    if (ev.oldResult && !integrity.acknowledged(acknowledged, 'Old external result')) errors.push('The printed old external result status is not stored separately in the original record. Verify that component against the original card before approval; the stored overall outcome must remain unchanged.');
    if (ev.oldGrade && String(ev.oldGrade).toUpperCase() !== sr.grade) errors.push('Document original grade conflicts with the selected original SubjectResult.');
  }
  return { errors: [...new Set(errors)], checks: documentChecks };
}
function eventFingerprint(saved, subjectId) {
  const doc = saved.documents?.[0] || {};
  return integrity.digest({ subjectId, document: doc.sha256 || saved.ocr?.raw_text || saved.ocr?.subjects || [] });
}
function eventReferences(saved) {
  return [...new Set([...String(saved.ocr?.raw_text || '').matchAll(/\bREVALUATION\s+(?:NO\.?|NUMBER|ROUND)\s*[:=#-]\s*([A-Z0-9/-]+)/gi)].map(match => match[1].toUpperCase()))];
}
const eventReference = saved => eventReferences(saved).length === 1 ? eventReferences(saved)[0] : null;
module.exports = { checks, snapshot, verify, eventFingerprint, eventReference, digest: integrity.digest };
