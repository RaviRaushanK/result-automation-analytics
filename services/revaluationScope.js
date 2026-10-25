'use strict';
const { code, duplicateRows, digest } = require('./academicIntegrity');
const manualDocumentDigest = saved => digest({ ocr: saved.ocr || {}, documents: saved.documents || [] });

// The roster is a lookup universe, never a source of revaluation rows.
// Resolve again against the exact Result, including during locked approval.
function resolve(saved, result) {
  const originals = result.SubjectResults || [];
  const targets = new Map();
  const documentRows = saved.ocr?.subjects || [];
  const manualRows = (saved.manual_subjects || []).map(entry => ({ ...entry,
    subjectCode: entry.subject_code, match_state: 'MANUAL_ENTRY', manual_entry: true }));
  const allRows = [...documentRows, ...manualRows];
  const entries = allRows.map((evidence, index) => {
    const rawCode = evidence.subjectCode || evidence.ocr_subject_code || evidence.subject_code || '';
    const normalized = code(rawCode);
    const matches = originals.filter(sr => normalized && code(sr.Subject?.subject_code) === normalized);
    const sr = matches.length === 1 ? matches[0] : null;
    let error = null;
    if (evidence.manual_entry && (evidence.document_digest !== manualDocumentDigest(saved)
      || !Number.isSafeInteger(Number(evidence.added_by)) || Number(evidence.added_by) <= 0))
      error = 'The manual subject entry is stale. Replace the document and add the subject again.';
    else if (!sr) error = matches.length > 1
      ? 'Subject cannot be uniquely identified in the selected Result/attempt.'
      : 'Subject does not belong to the selected Exam Session or original Result/attempt.';
    else if (evidence.subject_result_id != null && Number(evidence.subject_result_id) !== Number(sr.subject_result_id))
      error = 'Document subject binding does not match the selected original Result/attempt.';
    else if ((sr.result_id != null && result.result_id != null && Number(sr.result_id) !== Number(result.result_id))
      || (sr.Subject?.exam_session_id != null && result.exam_session_id != null
        && Number(sr.Subject.exam_session_id) !== Number(result.exam_session_id)))
      error = 'Subject does not belong to the selected Exam Session or original Result/attempt.';
    if (!error && !targets.has(Number(sr.subject_result_id))) targets.set(Number(sr.subject_result_id), { sr, evidence });
    return { evidence, code: rawCode || `Document row ${index + 1}`, sr, error };
  });
  const checks = entries.filter(entry => entry.error).map(entry => ({
    field: 'Subject ' + entry.code, status: 'MISMATCH', derived: false,
    document: entry.code, expected: entry.error
  }));
  for (const message of duplicateRows(allRows)) {
    const subjectCode = /^Multiple extracted rows identify ([A-Z0-9]+)\./.exec(message)?.[1];
    checks.push({ field: 'Subject ' + subjectCode, status: 'MISMATCH', derived: false,
      document: message, expected: 'One extracted row per subject' });
  }
  return { entries, targets, checks };
}

module.exports = { resolve, manualDocumentDigest };
