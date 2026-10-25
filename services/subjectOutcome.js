'use strict';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const original = (row, key, fallback) => row[key] !== undefined ? row[key] : row[fallback];

// Input is the server-side exact-attempt query projection. revaluated and
// revaluation_id come from the shared approved-effective join, never the UI.
function getSubjectOutcome(row) {
  const wasRevaluated = Number(row.revaluated) === 1
    && (row.revaluation_status === undefined || row.revaluation_status === 'approved')
    && (row.is_effective === undefined || Number(row.is_effective) === 1);
  const originalInternal = number(original(row, 'original_internal_marks', 'internal_marks'));
  const originalExternal = number(original(row, 'original_external_marks', 'external_marks'));
  const originalTotal = number(original(row, 'original_marks', 'marks'));
  const originalGrade = original(row, 'original_grade', 'grade') ?? null;
  const originalResult = original(row, 'original_result_status', 'result_status') ?? null;
  const effectiveInternal = wasRevaluated ? number(row.revised_internal_marks ?? originalInternal) : originalInternal;
  const effectiveExternal = wasRevaluated ? number(row.revised_external_marks ?? originalExternal) : originalExternal;
  const effectiveTotal = wasRevaluated ? number(row.marks ?? originalTotal) : originalTotal;
  const effectiveGrade = wasRevaluated ? row.grade ?? originalGrade : originalGrade;
  const effectiveResult = wasRevaluated ? row.result_status ?? originalResult : originalResult;
  const componentsReconciled = [effectiveInternal, effectiveExternal, effectiveTotal].every(value => value !== null)
    && effectiveInternal + effectiveExternal === effectiveTotal;
  return { originalInternal, originalExternal, originalTotal, originalGrade, originalResult,
    effectiveInternal, effectiveExternal, effectiveTotal, effectiveGrade, effectiveResult,
    wasRevaluated, revaluationId: wasRevaluated ? row.revaluation_id ?? null : null,
    internalSource: wasRevaluated && row.revised_internal_marks != null ? 'revised' : originalInternal !== null ? 'original' : 'unavailable',
    externalSource: wasRevaluated && row.revised_external_marks != null ? 'revised' : originalExternal !== null ? 'original' : 'unavailable',
    componentFallback: wasRevaluated && (row.revised_internal_marks == null || row.revised_external_marks == null),
    componentsReconciled };
}

function presentSubjectOutcome(row, mode) {
  const outcome = getSubjectOutcome(row);
  const effective = mode === 'effective';
  // Retain numeric cells and the established Consolidated limitation marker:
  // never portray components as adding up to a different authoritative total.
  const unavailable = effective && outcome.wasRevaluated && !outcome.componentsReconciled;
  return { ...row, ...outcome,
    internal_marks: unavailable ? null : effective ? outcome.effectiveInternal : outcome.originalInternal,
    external_marks: unavailable ? null : effective ? outcome.effectiveExternal : outcome.originalExternal,
    marks: effective ? outcome.effectiveTotal : outcome.originalTotal,
    grade: effective ? outcome.effectiveGrade : outcome.originalGrade,
    result_status: effective ? outcome.effectiveResult : outcome.originalResult };
}

module.exports = { getSubjectOutcome, presentSubjectOutcome };
