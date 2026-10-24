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

test('existing result drafts display clarified stage warnings without hiding unrelated warnings', () => {
  const template = fs.readFileSync(require('path').join(__dirname, '../views/results/review.ejs'), 'utf8');
  const start = template.indexOf("<% if (typeof warnings");
  const block = template.slice(start, template.indexOf('<% } %>', start) + '<% } %>'.length);
  const warnings = ['Vision reading was incomplete or unavailable on some pages. Verify the extracted rows against the card.', 'Student identity conflict'];
  const html = ejs.render(block, { warnings });
  assert.match(html, /does not mean the displayed values are incorrect/);
  assert.match(html, /Student identity conflict/);
  assert.equal(warnings[0], 'Vision reading was incomplete or unavailable on some pages. Verify the extracted rows against the card.');
});

test('revaluation period labels are readable while component acknowledgment stays mandatory', () => {
  const revaluation = require('../services/revaluationIntegrity');
  const period = { exam_start_month: 12, exam_start_year: 2025, exam_end_month: 1, exam_end_year: 2026 };
  const result = { ...attempt, Student: student, ExamSession: { semester: 1, ...period }, SubjectResults: [{ subject_result_id: 1, external_marks: 15, Subject: { subject_code: 'MMC105' } }] };
  const saved = { ocr: { student: { usn: student.usn }, semester: 1, ...period, subjects: [{ subject_result_id: 1, subjectCode: 'MMC105', oldMarks: 15, oldResult: 'F' }] } };
  const checks = revaluation.checks(saved, result);
  assert.equal(checks.find(check => check.field === 'Examination period').documentLabel, 'Dec 2025 / Jan 2026');
  assert.equal(checks.find(check => check.key === 'old_status').status, 'UNVERIFIED');
  assert.ok(revaluation.verify(saved, result).errors.some(error => /Old external result/.test(error)));
  assert.deepEqual(revaluation.verify(saved, result, [], { old_status: true }).errors, []);
  const wrong = { ...saved, ocr: { ...saved.ocr, exam_start_month: 5, exam_end_month: 6, exam_start_year: 2026 } };
  assert.ok(revaluation.verify(wrong, result, [], { old_status: true, period: true }).errors.some(error => /Approval is blocked/.test(error)));

  const template = fs.readFileSync(require('path').join(__dirname, '../views/revaluation/review.ejs'), 'utf8');
  const start = template.indexOf('<% if (meta.documentChecks)');
  const block = template.slice(start, template.indexOf('    <div class="card mb-3">', start));
  const render = documentChecks => ejs.render(block, { meta: { documentChecks }, review: {} });
  const html = render(checks);
  assert.match(html, /Dec 2025 \/ Jan 2026/);
  assert.doesNotMatch(html, /2025-12-2026-1/);
  assert.match(html, /I verified the old external PASS\/FAIL status against the original marks card/);
  assert.match(html, /this field must be checked manually/);
  assert.match(html, /name="verify_old_status"/);
  assert.doesNotMatch(html, /name="verify_(?:usn|semester|period)"/);
  const matched = render(checks.filter(check => check.key !== 'old_status'));
  assert.doesNotMatch(matched, /type="checkbox"|this field must be checked manually/);
});
test('all document identity fields match without acknowledgment; attempt/type derive from history', () => {
  assert.deepEqual(errors(full), []);
  for (const type of ['REGULAR', 'BACKLOG']) {
    const rows = integrity.summary(full, { ...session, ...student, exam_type: type, attempt_no: type === 'REGULAR' ? 1 : 2 });
    assert.equal(rows.find(r => r.field === 'Attempt').derived, true);
    assert.equal(rows.find(r => r.field === 'Exam type').derived, true);
  }
});

test('revaluation manual-status label renders unchecked and saved acknowledgments without changing automatic checks', () => {
  const source = fs.readFileSync(require('path').join(__dirname, '../views/revaluation/review.ejs'), 'utf8');
  const start = source.indexOf('<% if (meta.documentChecks)');
  const fragment = source.slice(start, source.indexOf('    <div class="card mb-3">', start));
  const manual = { field: 'Old external result', key: 'old_status', status: 'UNVERIFIED', derived: false };
  const automatic = [{ field: 'USN', key: 'usn', status: 'MATCH', document: 'TEST001' },
    { field: 'Semester', key: 'semester', status: 'MISMATCH', document: '2' }];
  const render = (review, check = manual) => ejs.render(fragment, { meta: { documentChecks: [...automatic, check] }, review });
  const initial = render(null);
  assert.match(initial, /Manual verification required/);
  assert.match(initial, /class="manual-verification-status is-required"/);
  assert.doesNotMatch(initial, /UNVERIFIED/);
  assert.match(initial, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(initial, /aria-describedby="verify_old_status_feedback oldExternalResultVerificationHelp oldExternalResultSaveHelp"/);
  assert.match(initial, /Select Validate to save this confirmation\. Approval remains a separate step/);
  const confirmed = render({ identity_verified: { old_status: true } });
  assert.match(confirmed, /Manually confirmed/);
  assert.match(confirmed, /class="manual-verification-status is-confirmed"/);
  assert.match(confirmed, /name="verify_old_status"[^>]* checked/);
  assert.doesNotMatch(confirmed, /Manual verification required/);
  const uncheckedAgain = render({ identity_verified: { old_status: false } });
  assert.match(uncheckedAgain, /Manual verification required/);
  assert.doesNotMatch(uncheckedAgain, /name="verify_old_status"[^>]* checked/);
  for (const html of [initial, confirmed, uncheckedAgain]) {
    assert.match(html, /<strong>USN:<\/strong>\s*MATCH/);
    assert.match(html, /<strong>Semester:<\/strong>\s*MISMATCH/);
    assert.doesNotMatch(html, /id="oldExternalResultVerificationStatus"[^>]*>\s*MATCH/);
  }
  const mismatched = render({ identity_verified: { old_status: true } }, { ...manual, status: 'MISMATCH' });
  assert.doesNotMatch(mismatched, /oldExternalResultVerificationStatus|name="verify_old_status"|Manually confirmed/);
  assert.match(mismatched, /<strong>Old external result:<\/strong>\s*MISMATCH/);
  assert.equal(manual.status, 'UNVERIFIED');
});

test('revaluation checkbox updates its accessible manual-status label in both directions without submitting', () => {
  const vm = require('node:vm');
  const script = fs.readFileSync(require('path').join(__dirname, '../public/js/revaluation-review.js'), 'utf8');
  for (const initialChecked of [false, true]) {
    const listeners = {};
    const checkbox = { checked: initialChecked, addEventListener(event, handler) { listeners[event] = handler; } };
    const classes = new Set();
    const status = { textContent: '', classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
    let submits = 0;
    const form = {
      querySelector: selector => selector === 'input[name="verify_old_status"]' ? checkbox : null,
      querySelectorAll: () => [], addEventListener() {}, submit() { submits++; }
    };
    const document = {
      getElementById: id => id === 'reviewForm' ? form : id === 'oldExternalResultVerificationStatus' ? status : null,
      querySelectorAll: () => []
    };
    vm.runInNewContext(script, { document });
    assert.equal(status.textContent, initialChecked ? 'Manually confirmed' : 'Manual verification required');
    checkbox.checked = true; listeners.change();
    assert.equal(status.textContent, 'Manually confirmed');
    assert.equal(classes.has('is-confirmed'), true);
    assert.equal(classes.has('is-required'), false);
    checkbox.checked = false; listeners.change();
    assert.equal(status.textContent, 'Manual verification required');
    assert.equal(classes.has('is-required'), true);
    assert.equal(classes.has('is-confirmed'), false);
    assert.equal(submits, 0);
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

test('mixed-semester review explains selected scope without disguising a genuine wrong semester', () => {
  const source = fs.readFileSync(require.resolve('../views/results/review.ejs'), 'utf8');
  const fragment = source.slice(source.indexOf('<strong>Document Verification'), source.indexOf('<div class="result-review-layout">'));
  const render = semesters => ejs.render(fragment, {
    documentChecks: integrity.summary({ ...full, semesters }, { ...session, ...student, ...attempt }),
    excludedSubjects: [{ subject_code: 'OTHER101' }], mixedContextVerified: true
  });
  const mixed = render([1, 2, 3]);
  assert.match(mixed, /MIXED DOCUMENT — scope verification required/);
  assert.match(mixed, /server must verify the excluded subjects/);
  assert.match(mixed, /name="verify_mixed_context" value="1"[^>]* checked/);
  const wrong = render([2, 3]);
  assert.doesNotMatch(wrong, /MIXED DOCUMENT — scope verification required/);
  assert.match(wrong, /Confirmation is blocked/);
});
