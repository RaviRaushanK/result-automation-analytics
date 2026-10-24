'use strict';
const integrity = require('./academicIntegrity');

// Existing VTU nine-column semantics: Internal is carried IA; Final is the
// revised external component. No component is obtained by subtracting totals.
function fromApprovedReview(row, proposal, subject, rawText = '') {
  row = row || {}; subject = subject || {};
  const knownVtu = /UPDATED\s+RESULTS\s+AFTER\s+REVALUATION/i.test(rawText)
    && /Internal/i.test(rawText) && /Old/i.test(rawText) && /RV/i.test(rawText) && /Final/i.test(rawText);
  const values = { revised_internal_marks: null, revised_external_marks: null };
  for (const [column, explicit, reviewed, maximum] of [
    ['revised_internal_marks', row.revisedInternalMarks, proposal.proposed_revised_internal_marks, subject.max_internal ?? 50],
    ['revised_external_marks', row.revisedExternalMarks ?? (knownVtu ? row.finalMarks : null), proposal.proposed_revised_external_marks, subject.max_external ?? 50]
  ]) {
    const source = integrity.mark(explicit), checked = integrity.mark(reviewed);
    if (!source.present) continue;
    if (source.invalid || source.value < 0 || source.value > Number(maximum)
      || checked.invalid || !checked.present || checked.value < 0 || checked.value > Number(maximum)) throw new Error('Revised component evidence is invalid or exceeds the course maximum.');
    if (source.value !== checked.value && !proposal.was_manual_correction) throw new Error('Revised component evidence changed. Validate the review again before approval.');
    values[column] = checked.value;
  }
  return values;
}
module.exports = { fromApprovedReview };
