'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const integrity = require('../services/revaluationIntegrity');
const filename = require.resolve('../views/revaluation/review.ejs');
const template = fs.readFileSync(filename, 'utf8');
const start = template.indexOf('  <% if (meta.documentChecks)');
const fragment = template.slice(start, template.indexOf('  <%#', start));
function fixture() {
  const codes = ['MMC101', 'MMC102', 'MMC103', 'MMC104', 'MMC105', 'MMCL106'];
  const result = { Student: { usn: 'TEST001' }, ExamSession: { semester: 1, exam_session: 'Jun', exam_year: 2026 }, attempt_no: 1, exam_type: 'REGULAR',
    SubjectResults: codes.map((code, index) => ({ subject_result_id: index + 1, external_marks: code === 'MMC105' ? 15 : 28,
      Subject: { subject_code: code, subject_type: 'theory', max_external: 50 } })) };
  const saved = { ocr: { student: { usn: 'TEST001' }, semester: 1, exam_session: 'Jun', exam_year: 2026,
    subjects: codes.map((code, index) => ({ subject_result_id: index + 1, subjectCode: code, oldMarks: code === 'MMC105' ? 15 : 28, oldResult: code === 'MMC105' ? 'F' : 'P' })) } };
  const rows = codes.map((code, index) => ({ srid: index + 1, code, evidence: { match_state: 'MATCHED', subjectCode: code,
    ocr_subject_code: code, normalized: code, oldMarks: saved.ocr.subjects[index].oldMarks, oldResult: saved.ocr.subjects[index].oldResult,
    revised_ext: 20, revised_total: 50, raw_line: 'raw <OCR> ' + code, confidence: 'HIGH' } }));
  function render(extra = {}) {
    const checks = integrity.checks(saved, result);
    const before = JSON.stringify({ checks, saved, result, rows });
    const html = ejs.render(fragment, { meta: { documentChecks: checks }, review: null, rows, errors: {}, ...extra }, { filename });
    assert.equal(JSON.stringify({ checks, saved, result, rows }), before, 'presentation does not mutate evidence or checks');
    return { html, main: html.split('<details class="verification-details')[0], details: html.split('<details class="verification-details')[1] };
  }
  return { result, saved, rows, render };
}
function counts(main, verified, mismatch, manual) {
  assert.match(main, new RegExp(`${verified} subjects? verified`));
  assert.match(main, new RegExp(`${mismatch} mismatch`));
  assert.match(main, new RegExp(`${manual} manual checks required`));
}
test('six internally matching subjects produce one compact summary and collapsed successful details', () => {
  const f = fixture(), { html, main, details } = f.render();
  counts(main, 6, 0, 0);
  assert.match(main, /data-all-verified="true"/);
  assert.doesNotMatch(main, /MMC10|MMCL106|MATCH|verification-issue/);
  assert.match(html, /<details class="verification-details mt-2">\s*<summary class="py-1">View verification details<\/summary>/);
  assert.equal((details.match(/&mdash; Verified<\/strong>/g) || []).length, 6);
  assert.match(details, /MMC105 &mdash; Verified/);
  assert.match(details, /Old EX: 15 &middot; Old result: FAIL/);
  assert.match(details, /Revised EX: 20 &middot; Effective total: 50/);
  assert.match(details, /Printed old result: F &middot; Derived old result: FAIL/);
  assert.match(details, /raw &lt;OCR&gt; MMC105/);
  assert.doesNotMatch(details, />MATCH</);
  for (const field of ['USN', 'Semester', 'Examination period', 'Attempt', 'Exam type']) {
    assert.equal((html.match(new RegExp(`<strong>${field}:<\/strong>`, 'g')) || []).length, 1, `${field} is displayed once`);
  }
  assert.doesNotMatch(html, /subjects verified successfully|No mismatches or manual checks required/);
});
test('multiple mismatched comparisons count as one subject and remain outside disclosures', () => {
  const f = fixture(); f.saved.ocr.subjects[4].oldMarks = 18; f.saved.ocr.subjects[4].oldResult = 'P';
  const { main } = f.render(); counts(main, 5, 1, 0);
  assert.match(main, /MMC105 &mdash; MISMATCH/);
  assert.match(main, /Stored history: 15 &mdash; Document: 18/);
  assert.match(main, /Stored history: FAIL &mdash; Document: PASS/);
  assert.doesNotMatch(main, /MMC101|MMC102|MMC103|MMC104|MMCL106/);
});
test('unavailable old marks show only the affected subject and preserve targeted manual controls', () => {
  const f = fixture(); f.result.SubjectResults[2].external_marks = null;
  const { main } = f.render(); counts(main, 5, 0, 1);
  assert.match(main, /MMC103 &mdash; MANUAL VERIFICATION REQUIRED/);
  assert.match(main, /Original external marks are unavailable/);
  assert.match(main, /form="reviewForm"[^>]*name="verify_old_status_3"[^>]*required/);
  assert.match(main, /name="verify_old_marks"/);
  assert.doesNotMatch(main, /MMC101|MMC102|MMC104|MMC105|MMCL106/);
});
test('mixed outcomes use subject counts with hard mismatch taking precedence over manual checks', () => {
  const f = fixture(); f.saved.ocr.subjects[4].oldMarks = 18; f.saved.ocr.subjects[4].oldResult = 'X';
  f.result.SubjectResults[2].external_marks = null;
  const { main } = f.render(); counts(main, 4, 1, 1);
  assert.match(main, /MMC105 &mdash; MISMATCH/);
  assert.match(main, /MMC103 &mdash; MANUAL VERIFICATION REQUIRED/);
  assert.doesNotMatch(main, /MMC101|MMC102|MMC104|MMCL106/);
});
test('saved manual acknowledgment stays manual and its control remains visible', () => {
  const f = fixture(); f.saved.ocr.subjects[2].oldResult = 'X';
  const { main } = f.render({ review: { identity_verified: { old_status_3: true } } });
  counts(main, 5, 0, 1);
  assert.match(main, /Manually confirmed/);
  assert.match(main, /name="verify_old_status_3"[^>]*checked/);
});

test('missing stored values are not presented as verified document values in compact details', () => {
  const f = fixture(); f.result.SubjectResults[2].external_marks = null;
  const { details } = f.render();
  assert.match(details, /MMC103 &mdash; MANUAL VERIFICATION REQUIRED<\/strong>\s*<div>Old EX: Unavailable &middot; Old result: Unavailable/);
  assert.match(details, /Document old EX: 28 &middot; Document old result: P/);
});

test('even history-derived contradictions remain prominent and prevent an all-success message', () => {
  const f = fixture();
  const checks = integrity.checks(f.saved, f.result);
  checks.push({ field: 'Original attempt', status: 'MISMATCH', derived: true, expected: 1, document: 2 });
  checks.push({ field: 'ExamSession MMC105', subject_result_id: 5, status: 'MISMATCH', derived: true, expected: 7, document: 8 });
  const { main } = f.render({ meta: { documentChecks: checks } });
  counts(main, 5, 1, 0);
  assert.match(main, /Original attempt:<\/strong>\s*<span class="badge bg-danger">MISMATCH/);
  assert.match(main, /ExamSession MMC105:<\/strong>\s*<span class="badge bg-danger">MISMATCH/);
  assert.doesNotMatch(main, /data-all-verified="true"/);
});

test('expanded evidence preserves revised components, result tokens and manual correction metadata', () => {
  const f = fixture();
  Object.assign(f.rows[4].evidence, { revised_int: 30, rvResult: 'P', finalResult: 'PASS' });
  const checks = integrity.checks(f.saved, f.result);
  Object.assign(checks.find(check => check.key === 'usn'), { manual: true, corrected: 'TEST001' });
  const { details } = f.render({ meta: { documentChecks: checks } });
  assert.match(details, /Revised internal: 30 &middot; RV result: P &middot; Final result: PASS/);
  assert.match(details, /Manual correction: TEST001/);
});
test('context contradictions, missing evidence and row validation errors cannot yield an all-success message', () => {
  const f = fixture(); f.saved.ocr.student.usn = 'WRONG';
  assert.match(f.render().main, /USN[\s\S]*MISMATCH/);
  assert.doesNotMatch(f.render().main, /data-all-verified="true"/);
  f.rows[0].evidence.match_state = 'SELECTED_BUT_NOT_FOUND';
  counts(f.render().main, 5, 0, 1);
  const { main } = f.render({ errors: { 2: ['Inconsistent revised marks'] } });
  counts(main, 4, 1, 1); assert.match(main, /Inconsistent revised marks/);
});
test('unmatched subject checks remain visible and zero values remain readable', () => {
  const f = fixture(); f.result.SubjectResults[0].external_marks = 0; f.saved.ocr.subjects[0].oldMarks = 0; f.saved.ocr.subjects[0].oldResult = 'F';
  assert.match(f.render().details, /Old EX: 0/);
  f.saved.ocr.subjects.push({ subjectCode: 'UNKNOWN', oldResult: 'P' });
  const { main } = f.render(); counts(main, 6, 1, 0);
  assert.match(main, /UNKNOWN &mdash; MISMATCH/);
});
test('native disclosure and wrapping styles inherit paired light/dark review colors', () => {
  const css = fs.readFileSync(require.resolve('../public/css/result-management.css'), 'utf8');
  for (const theme of ['light', 'dark']) {
    const { html } = fixture().render();
    const themed = `<html data-theme="${theme}">${html}</html>`;
    assert.match(themed, /<summary class="py-1">View verification details/);
    assert.doesNotMatch(themed, /<details[^>]*\bopen(?:\s|>)/);
  }
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--review-info-text:/);
  assert.match(css, /\.revaluation-verification \{ min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.revaluation-verification summary:focus-visible/);
  assert.match(css, /\.revaluation-verification \.verification-issue > strong \{ color: var\(--review-info-error\)/);
});

test('complete review renders edit, locked and confirmation modes with the same compact verification', () => {
  const f = fixture();
  f.rows.forEach(row => Object.assign(row, { name: row.code, origMarks: 45, origStatus: 'fail', maxInternal: 50, maxExternal: 50, maxMarks: 100, pickOptions: [] }));
  const meta = { documentChecks: integrity.checks(f.saved, f.result), warnings: [], studentName: 'Test Student', studentUsn: 'TEST001', attemptNo: 1, examType: 'REGULAR', importId: 1, resultId: 1 };
  for (const mode of ['edit', 'locked', 'confirm']) {
    const html = ejs.render(template, { meta, rows: f.rows, mode, error: null, notice: null, enteredVals: {}, errors: {}, review: mode === 'edit' ? null : { proposal: [] } }, { filename });
    assert.match(html, /data-all-verified="true"/);
    assert.match(html, /View verification details/);
    assert.match(html, /id="reviewForm"/);
    if (mode !== 'edit') assert.match(html, /id="approveRevaluationForm"/);
  }
});
