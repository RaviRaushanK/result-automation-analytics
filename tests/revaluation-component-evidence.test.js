'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/revaluationComponentEvidence');
const subject = { max_internal: 50, max_external: 50 };
const proposal = { proposed_revised_internal_marks: 30, proposed_revised_external_marks: 20 };
const vtu = 'VTU UPDATED RESULTS AFTER REVALUATION Internal Old RV Final Marks';
test('known VTU final external is persisted; carried original IA is not a revision', () => {
  assert.deepEqual(service.fromApprovedReview({ internalMarks: 30, oldMarks: 15, rvMarks: 19, finalMarks: 20 }, proposal, subject, vtu),
    { revised_internal_marks: null, revised_external_marks: 20 });
});
test('unknown semantics, absent evidence and totals alone do not produce revised components', () => {
  for (const row of [{ internalMarks: 30, finalMarks: 20 }, { revised_marks: 50 }, {}]) {
    assert.deepEqual(service.fromApprovedReview(row, proposal, subject), { revised_internal_marks: null, revised_external_marks: null });
  }
});
test('explicit revised IA and zero values remain independent of totals', () => {
  assert.deepEqual(service.fromApprovedReview({ revisedInternalMarks: 0, revisedExternalMarks: 20 }, { ...proposal, proposed_revised_internal_marks: 0 }, subject),
    { revised_internal_marks: 0, revised_external_marks: 20 });
});
test('range, malformed evidence and unreviewed changes are rejected; existing manual review remains supported', () => {
  for (const value of [-1,51,'2e1','wrong',[],2.5]) assert.throws(() => service.fromApprovedReview({ revisedExternalMarks: value }, proposal, subject));
  assert.throws(() => service.fromApprovedReview({ finalMarks: 21 }, proposal, subject, vtu), /changed/);
  assert.equal(service.fromApprovedReview({ finalMarks: 21 }, { ...proposal, was_manual_correction: true }, subject, vtu).revised_external_marks, 20);
});
