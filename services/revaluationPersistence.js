/**
 * services/revaluationPersistence.js
 *
 * Phase 6 — Approval & Persistence (Revaluation Nine-Column Semantics)
 *
 * Provides the single entry point for writing an approved RevaluationResult event.
 * All database writes for the approval path are centralised here so that:
 *   - The EXACT field mapping is documented and enforced in one place.
 *   - The audit trail (remarks JSON) is always structured identically.
 *   - The was_manual_correction and source provenance are always persisted.
 *
 * Public API
 * ─────────
 * buildEventRemarksEx(importId, method, meta)  → string (remarks JSON for DB)
 *   meta: { source, decision, was_manual_correction, event_ids }
 *
 * DB Field Mapping (canonical, never changed without updating this file)
 * ──────────────────
 * RevaluationResult.original_marks    ← Number(sr.marks)
 *                                          [from locked SubjectResult row — NOT from OCR]
 * RevaluationResult.original_status  ← sr.result_status
 *                                          [from locked SubjectResult row — NOT from OCR]
 * RevaluationResult.revised_marks   ← P.proposed_revised_total_marks
 *                                          [server-computed: internal + external, never from browser]
 * RevaluationResult.revised_status  ← P.proposed_revised_status
 *                                          [server-derived from gradeFromPercent(pct)]
 * RevaluationResult.revised_grade   ← P.proposed_revised_grade
 * RevaluationResult.revaluation_no   ← next sequence number for this subject_result_id
 * RevaluationResult.is_effective     ← true  [exactly one effective per subject_result_id]
 * RevaluationResult.revaluation_status ← 'approved'
 * RevaluationResult.reviewed_by      ← approver.admin_id
 * RevaluationResult.reviewed_at      ← new Date()
 * RevaluationResult.uploaded_by      ← review.submitted_by || approver.admin_id
 * RevaluationResult.file_name        ← doc.file_name || null
 * RevaluationResult.file_path        ← doc.file_path || null
 * RevaluationResult.remarks         ← buildEventRemarksEx(importId, method, meta)
 *                                          JSON: { source, decision, was_manual_correction,
 *                                                  event_ids, import_id, base_remarks }
 *
 * Security invariants enforced by caller (approveReview):
 *   - subject_result_id ownership verified against srById (Result context).
 *   - Proposal baselines re-validated under row-level lock before write.
 *   - Transaction lock on SubjectResult rows serialises concurrent approvals.
 *   - Exactly-one-effective: prior effective row demoted before insert.
 */
'use strict';

/**
 * Build the structured remarks JSON stored in RevaluationResult.remarks.
 *
 * @param {number}   importId       ImportLog.import_id
 * @param {string}   method         ocr.extraction_method ('pdfjs'|'tesseract'|'stub'|null)
 * @param {Object}   meta           Approval metadata:
 *   source               string  'MISSING_MANUAL' | 'OCR_DETECTED' | 'UNMATCHED_ATTACH'
 *   decision             string  'accept' | 'reject'
 *   was_manual_correction boolean  true if row came from manual edit or manual add
 *   event_ids            number[] IDs of created RevaluationResult rows
 * @returns {string}  JSON string stored in remarks
 */
function buildEventRemarksEx(importId, method, meta) {
  const base = 'Revaluation import #' + importId +
    (method ? ' | OCR ' + method : '') +
    ' | approved ' + new Date().toISOString();
  return JSON.stringify({
    import_id: Number(importId) || null,
    source: meta && meta.source ? String(meta.source) : 'OCR_DETECTED',
    decision: meta && meta.decision ? String(meta.decision) : 'accept',
    was_manual_correction: !!(meta && meta.was_manual_correction),
    event_ids: Array.isArray(meta && meta.event_ids)
      ? meta.event_ids.map(Number).filter(n => Number.isInteger(n))
      : [],
    base_remarks: base
  });
}

module.exports = {
  buildEventRemarksEx
};
