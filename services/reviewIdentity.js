'use strict';
const integrity = require('./academicIntegrity');
const normalizeName = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase() : '';
const correctableConflicts = new Set([
  'AI readings identify conflicting student USNs. Re-extract the correct document.',
  'OCR readings identify conflicting student USNs. Re-extract the correct document.',
  'The AI readings disagree on the student USN. Check the identity against the original card.'
]);
function source(saved, kind) {
  const evidence = kind === 'revaluation' ? saved.ocr || {} : saved.document_evidence || {};
  const original = kind === 'revaluation' ? evidence.student_candidates || {} : saved.extracted_identity || saved.student || {};
  const conflicts = kind === 'revaluation' ? evidence.integrity_conflicts || [] : saved.integrity_conflicts || [];
  return { usns: integrity.claims(evidence).usns, name: original.name || '', conflicts,
    documents: (saved.documents || []).map(document => String(document.sha256 || document.file_name || '')),
    rawHash: integrity.digest(evidence.raw_text || evidence.rawText || '') };
}
function sourceDigest(saved, kind) {
  const data = source(saved, kind);
  return integrity.digest([data.usns.map(integrity.usn).sort(), normalizeName(data.name), [...data.conflicts].sort(), data.rawHash, data.documents]);
}
function targetKey(target) {
  return [target.student_id, target.batch_id, target.exam_session_id, target.result_id].map(value => String(value ?? ''))
    .concat([integrity.usn(target.usn), normalizeName(target.name)]);
}
function valid(saved, target, kind) {
  const record = saved.identity_correction;
  return !!record && record.method === 'ADMIN_REVIEW' && record.kind === kind
    && record.source_digest === sourceDigest(saved, kind)
    && integrity.usn(record.corrected?.usn) === integrity.usn(target.usn)
    && normalizeName(record.corrected?.name) === normalizeName(target.name)
    && integrity.digest(record.target) === integrity.digest(targetKey(target));
}
function propose(saved, target, body, kind, adminId) {
  if (body.identity_review !== '1' || typeof body.usn !== 'string' || typeof body.name !== 'string'
    || !integrity.usn(body.usn) || !normalizeName(body.name)
    || integrity.usn(body.usn) !== integrity.usn(target.usn) || normalizeName(body.name) !== normalizeName(target.name)) return null;
  if (valid(saved, target, kind)) return saved.identity_correction;
  const data = source(saved, kind);
  const needsCorrection = data.usns.some(value => integrity.usn(value) !== integrity.usn(target.usn))
    || normalizeName(data.name) !== normalizeName(target.name) || data.conflicts.some(value => correctableConflicts.has(value));
  if (!needsCorrection) return null;
  return { method: 'ADMIN_REVIEW', kind, source_digest: sourceDigest(saved, kind), target: targetKey(target),
    original: { usns: data.usns, name: data.name }, corrected: { usn: integrity.usn(target.usn), name: body.name.trim() },
    admin_id: adminId || null, confirmed_at: new Date().toISOString() };
}
function blockingConflicts(saved, target, kind) {
  const conflicts = source(saved, kind).conflicts;
  return valid(saved, target, kind) ? conflicts.filter(value => !correctableConflicts.has(value)) : conflicts;
}
function annotate(checks, saved, target, kind) {
  return valid(saved, target, kind) ? checks.map(check => check.field === 'USN'
    ? { ...check, status: 'MANUALLY CORRECTED', manual: true, corrected: integrity.usn(target.usn) } : check) : checks;
}
function originalTarget(session, student) {
  return { student_id: student?.student_id, batch_id: session.batch_id, exam_session_id: session.exam_session_id,
    usn: student?.usn, name: student?.student_name };
}
function revaluationTarget(result) {
  return { student_id: result.student_id, batch_id: result.ExamSession?.batch_id, exam_session_id: result.exam_session_id,
    result_id: result.result_id, usn: result.Student?.usn, name: result.Student?.student_name };
}
module.exports = { propose, valid, annotate, blockingConflicts, originalTarget, revaluationTarget, normalizeName };
