'use strict';
const integrity = require('./academicIntegrity');
const reviewIdentity = require('./reviewIdentity');
const passRules = require('./academicPolicy').passRules;
const documentScope = require('./revaluationScope');
const target = result => ({ usn: result.Student?.usn, semester: result.ExamSession?.semester,
  exam_start_month: result.ExamSession?.exam_start_month, exam_start_year: result.ExamSession?.exam_start_year,
  exam_end_month: result.ExamSession?.exam_end_month, exam_end_year: result.ExamSession?.exam_end_year,
  exam_session: result.ExamSession?.exam_session, exam_year: result.ExamSession?.exam_year,
  attempt_no: result.attempt_no, exam_type: result.exam_type });
function checks(saved, result) {
  const list = reviewIdentity.annotate(integrity.summary(saved.ocr || {}, target(result)), saved, reviewIdentity.revaluationTarget(result), 'revaluation');
  const scope = documentScope.resolve(saved, result);
  list.push(...scope.checks);
  for (const { evidence, code } of scope.entries.filter(entry => entry.evidence.manual_entry)) {
    list.push({ field: 'Manual subject ' + code, key: 'manual_subject_' + evidence.subject_result_id,
      subject_result_id: evidence.subject_result_id, status: 'UNVERIFIED', derived: false,
      expected: 'OCR did not detect this subject. Confirm that it appears on the uploaded card and verify the marks entered below.' });
  }
  const rows = saved.ocr?.subjects || [];
  if (rows.some(ev => integrity.present(ev.oldMarks) && !integrity.present(subjectResultForEvidence(result, ev)?.external_marks))) list.push({ field: 'Old external marks', key: 'old_marks', status: 'UNVERIFIED', document: '', expected: 'Original external marks are unavailable', derived: false });
  for (const ev of rows) {
    const sr = subjectResultForEvidence(result, ev);
    const documentCode = ev.subjectCode || ev.ocr_subject_code || sr?.Subject?.subject_code || '';
    const oldStatusKey = 'old_status_' + (sr?.subject_result_id || integrity.code(documentCode) || 'unknown');
    if (!sr) {
      list.push(manualOldStatusCheck(documentCode, oldStatusKey, ev.oldResult));
      continue;
    }
    if (documentCode) list.push({ field: 'Subject ' + documentCode, status: integrity.code(documentCode) === integrity.code(sr.Subject?.subject_code) ? 'MATCH' : 'MISMATCH', document: documentCode, expected: sr.Subject?.subject_code, derived: false });
    if (integrity.present(ev.oldMarks) && integrity.present(sr.external_marks)) list.push({ field: 'Old external marks ' + (documentCode || ''), status: Number(ev.oldMarks) === Number(sr.external_marks) ? 'MATCH' : 'MISMATCH', document: ev.oldMarks, expected: sr.external_marks, derived: false });
    const printed = normalizeComponentStatus(ev.oldResult);
    const stored = storedExternalStatus(sr);
    if (printed && stored) list.push({ field: 'Old external result ' + documentCode, key: oldStatusKey,
      status: printed === stored ? 'MATCH' : 'MISMATCH', document: printed.toUpperCase(), expected: stored.toUpperCase(),
      printed_old_external_result: String(ev.oldResult).trim(), derived_old_external_result: stored.toUpperCase(),
      subject_result_id: sr.subject_result_id, derived: false });
    else list.push(manualOldStatusCheck(documentCode, oldStatusKey, ev.oldResult, sr.subject_result_id));
  }
  return list;
}
function normalizeComponentStatus(value) {
  const token = String(value || '').trim().toUpperCase();
  if (['P', 'PASS', 'PASSED'].includes(token)) return 'pass';
  if (['F', 'FAIL', 'FAILED'].includes(token)) return 'fail';
  return null;
}
function storedExternalStatus(sr) {
  if (!integrity.present(sr?.external_marks) || !sr?.Subject) return null;
  const external = Number(sr.external_marks);
  const outcome = passRules.evaluateExternal(external, sr.Subject);
  return outcome.valid ? outcome.status : null;
}
function subjectResultForEvidence(result, ev) {
  const rows = result.SubjectResults || [];
  const byId = rows.find(sr => Number(sr.subject_result_id) === Number(ev.subject_result_id));
  if (byId) return byId;
  const code = integrity.code(ev.subjectCode || ev.ocr_subject_code);
  const byCode = code ? rows.filter(sr => integrity.code(sr.Subject?.subject_code) === code) : [];
  return byCode.length === 1 ? byCode[0] : null;
}
function manualOldStatusCheck(code, key, printed, subjectResultId) {
  return { field: 'Old external result' + (code ? ' ' + code : ''), key, status: 'UNVERIFIED',
    document: printed ? String(printed).trim().toUpperCase() : '',
    expected: 'External component status cannot be safely compared', subject_result_id: subjectResultId,
    manual: true, derived: false };
}
function snapshot(result) {
  return { pass_rules_version: require('./academicPolicy').passRules.version,
    student_id: result.student_id, usn: result.Student?.usn, exam_session_id: result.exam_session_id,
    semester: result.ExamSession?.semester,
    exam_start_month: result.ExamSession?.exam_start_month, exam_start_year: result.ExamSession?.exam_start_year,
    exam_end_month: result.ExamSession?.exam_end_month, exam_end_year: result.ExamSession?.exam_end_year,
    exam_session: result.ExamSession?.exam_session, exam_year: result.ExamSession?.exam_year,
    attempt_no: result.attempt_no, exam_type: result.exam_type,
    subjects: (result.SubjectResults || []).map(sr => ({ id: sr.subject_result_id, subject_id: sr.subject_id, marks: sr.marks,
      internal: sr.internal_marks, external: sr.external_marks,
      status: sr.result_status, grade: sr.grade, subject: sr.Subject?.toJSON ? sr.Subject.toJSON() : sr.Subject })).sort((a, b) => a.id - b.id) };
}
// MySQL JSON storage may reorder object keys. Compare the saved academic
// snapshot by value, while preserving array order, types and every field.
function snapshotDigest(value) {
  return integrity.digest(JSON.stringify(value, (key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(field => [field, item[field]]))
      : item));
}
function verify(saved, result, proposals = [], acknowledged = false) {
  const errors = [], documentChecks = checks(saved, result);
  const scope = documentScope.resolve(saved, result);
  if (saved.identity_correction && !reviewIdentity.valid(saved, reviewIdentity.revaluationTarget(result), 'revaluation')) errors.push('The manual identity correction is stale or does not match the current registered student and attempt. Correct the identity and Validate again.');
  if (!result.Student || !integrity.usn(result.Student.usn) || !result.ExamSession) errors.push('The authoritative original student or examination context is unavailable. Restore or verify the registered student and select the correct existing attempt before revaluation.');
  if (result.Student?.batch_id !== undefined && result.ExamSession?.batch_id !== undefined
    && String(result.Student.batch_id) !== String(result.ExamSession.batch_id)) errors.push('The original student and examination batch do not match. Resolve the historical association through a controlled academic workflow before revaluation.');
  for (const check of documentChecks.filter(check => check.status === 'MISMATCH')) errors.push(
    `The revaluation document identifies ${check.field} ${check.documentLabel || check.document}, but the selected result identifies ${check.expectedLabel || check.expected}. Approval is blocked. Select the correct attempt or replace the document.`);
  for (const check of documentChecks.filter(check => !check.derived)) {
    if (check.key?.startsWith('manual_subject_') && !proposals.some(p => p.decision === 'accept'
      && Number(p.bound_to_srid || p.subject_result_id) === Number(check.subject_result_id))) continue;
    if (['NOT PRESENT IN DOCUMENT','UNVERIFIED'].includes(check.status) && !checkAcknowledged(acknowledged, check)) errors.push(`Verify ${check.field} against the original card because authoritative comparison is unavailable.`);
  }
  errors.push(...integrity.duplicateRows(saved.ocr?.subjects));
  errors.push(...reviewIdentity.blockingConflicts(saved, reviewIdentity.revaluationTarget(result), 'revaluation'));
  if (eventReferences(saved).length > 1) errors.push('The document identifies conflicting revaluation event references. Re-extract the correct event document.');
  for (const p of proposals.filter(p => p.decision === 'accept')) {
    const id = Number(p.bound_to_srid || p.subject_result_id);
    const sr = result.SubjectResults.find(sr => Number(sr.subject_result_id) === id);
    if (!sr) { errors.push('The subject does not belong to the selected existing attempt.'); continue; }
    if (!sr.Subject || !sr.Subject.subject_code) { errors.push('The authoritative original subject offering is unavailable. Select an existing subject from the correct attempt.'); continue; }
    if (!scope.targets.has(id) || !scope.targets.has(Number(p.subject_result_id))) {
      errors.push('The document does not identify the accepted subject in this exact Result/attempt. Re-extract the document before approval.');
      continue;
    }
    if (String(sr.result_id) !== String(result.result_id)
      || sr.Subject?.exam_session_id !== undefined && String(sr.Subject.exam_session_id) !== String(result.exam_session_id)) errors.push('The original subject offering does not belong to this exact examination attempt.');
    if (scope.targets.get(id)?.evidence.manual_entry) continue; // Targeted card acknowledgment is checked above.
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
    // PASS/FAIL is reconstructed from the stored external mark using the
    // versioned subject threshold. Legacy/special statuses remain manual.
    if (ev.oldGrade && String(ev.oldGrade).toUpperCase() !== sr.grade) errors.push('Document original grade conflicts with the selected original SubjectResult.');
  }
  return { errors: [...new Set(errors)], checks: documentChecks };
}
function checkAcknowledged(values, check) {
  return values === true || check.key && values?.[check.key] === true || integrity.acknowledged(values, check.field);
}
function eventFingerprint(saved, subjectId) {
  const doc = saved.documents?.[0] || {};
  return integrity.digest({ subjectId, document: doc.sha256 || saved.ocr?.raw_text || saved.ocr?.subjects || [] });
}
function eventReferences(saved) {
  return [...new Set([...String(saved.ocr?.raw_text || '').matchAll(/\bREVALUATION\s+(?:NO\.?|NUMBER|ROUND)\s*[:=#-]\s*([A-Z0-9/-]+)/gi)].map(match => match[1].toUpperCase()))];
}
const eventReference = saved => eventReferences(saved).length === 1 ? eventReferences(saved)[0] : null;
module.exports = { checks, snapshot, snapshotDigest, verify, eventFingerprint, eventReference, digest: integrity.digest };
