'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const integrity = require('../services/academicIntegrity');
const ejs = require('ejs');
const fs = require('fs');
const session = { semester: '1', exam_session: 'Jun', exam_year: 2026 };
const student = { usn: 'TEST001' }, attempt = { exam_type: 'REGULAR', attempt_no: 1 };
const full = { usns: ['TEST001'], semesters: [1], periods: [{ exam_session: 'Jun', exam_year: 2026 }] };
const errors = (evidence, ack = {}) => integrity.originalDocumentErrors({ document_evidence: evidence }, session, student, attempt, ack, false);
test('all document identity fields match without acknowledgment; attempt/type derive from history', () => {
  assert.deepEqual(errors(full), []);
  for (const type of ['REGULAR', 'BACKLOG']) {
    const rows = integrity.summary(full, { ...session, ...student, exam_type: type, attempt_no: type === 'REGULAR' ? 1 : 2 });
    assert.equal(rows.find(r => r.field === 'Attempt').derived, true);
    assert.equal(rows.find(r => r.field === 'Exam type').derived, true);
  }
});
test('missing critical fields require their own acknowledgment; blanket flag has no effect', () => {
  const missingPeriod = { ...full, periods: [] };
  assert.match(errors(missingPeriod).join(), /examination period/);
  assert.deepEqual(errors(missingPeriod, { period: true }), []);
  assert.ok(errors(missingPeriod, integrity.acknowledgments({ verify_document_context: '1' })).length);
  const missingUsn = { ...full, usns: [] };
  assert.match(errors(missingUsn).join(), /USN/);
  assert.ok(errors(missingUsn, { period: true }).length);
  assert.deepEqual(errors(missingUsn, { usn: true }), []);
});
test('validation errors name only unresolved fields and never history-derived fields', () => {
  assert.deepEqual(errors(full), []);
  const onlyPeriod = errors({ ...full, periods: [] }).join(' ');
  assert.match(onlyPeriod, /examination period/);
  assert.doesNotMatch(onlyPeriod, /USN|semester|attempt|exam type|all examination details/i);
  const onlyIdentity = errors({ ...full, usns: [] }).join(' ');
  assert.match(onlyIdentity, /student identity.*USN/);
  assert.doesNotMatch(onlyIdentity, /semester|examination period|attempt|exam type/i);
  const both = errors({ ...full, usns: [], periods: [] });
  assert.equal(both.length, 2);
  assert.match(both.join(' '), /student identity/);
  assert.match(both.join(' '), /examination period/);
  assert.doesNotMatch(both.join(' '), /semester|attempt|exam type/i);
});
test('positive period/type contradictions cannot be acknowledged away', () => {
  assert.match(errors({ ...full, periods: [{ exam_session: 'Dec', exam_year: 2025 }] }, { period: true }).join(), /does not match/);
  assert.match(errors({ ...full, types: ['BACKLOG'] }, { period: true }).join(), /does not match/);
});

test('Review renders only missing-field checkboxes and labels attempts as history-derived', () => {
  const source = fs.readFileSync(require.resolve('../views/results/review.ejs'), 'utf8');
  const fragment = source.slice(source.indexOf('<strong>Document Verification'), source.indexOf('<div class="result-review-layout">'));
  const render = evidence => ejs.render(fragment, { documentChecks: integrity.summary(evidence, { ...session, ...student, ...attempt }), excludedSubjects: [] });
  assert.doesNotMatch(render(full), /type="checkbox"/);
  assert.match(render(full), /Derived from academic history/);
  assert.match(render({ ...full, periods: [] }), /name="verify_period"/);
  assert.doesNotMatch(render({ ...full, periods: [] }), /name="verify_usn"/);
  assert.match(render({ ...full, usns: [] }), /name="verify_usn"/);
});
