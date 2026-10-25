'use strict';

// Same SubjectResult only: history/retake selection is deliberately not part
// of this join. The event number is unique per subject_result_id.
function effectiveEventJoin(components = false, eventOriginal = false) {
  return `
  LEFT JOIN (
    SELECT e.revaluation_id, e.subject_result_id, e.revised_marks,
           e.revised_status, e.revised_grade${components ? ', e.revised_internal_marks, e.revised_external_marks' : ''}${eventOriginal ? ', e.original_marks, e.original_status' : ''}
    FROM revaluation_results e
    INNER JOIN (
      SELECT subject_result_id, MAX(revaluation_no) AS max_no
      FROM revaluation_results
      WHERE is_effective = 1 AND revaluation_status = 'approved'
      GROUP BY subject_result_id
    ) pick ON pick.subject_result_id = e.subject_result_id AND pick.max_no = e.revaluation_no
    WHERE e.is_effective = 1 AND e.revaluation_status = 'approved'
  ) eff ON eff.subject_result_id = sr.subject_result_id
`;
}

function expressions(mode) {
  const effective = mode === 'effective';
  return {
    marks: effective ? 'COALESCE(eff.revised_marks, sr.marks)' : 'sr.marks',
    grade: effective ? 'COALESCE(eff.revised_grade, sr.grade)' : 'sr.grade',
    status: effective ? 'COALESCE(eff.revised_status, sr.result_status)' : 'sr.result_status'
  };
}

module.exports = { effectiveEventJoin, expressions };
