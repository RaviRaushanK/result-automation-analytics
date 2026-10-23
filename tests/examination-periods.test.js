'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const period = require('../public/js/exam-period');
const policy = require('../services/academicPolicy');
const sessionController = require('../controllers/sessionController');
const integrity = require('../services/academicIntegrity');

test('labeled examination periods retain positive contradiction protection', () => {
  for (const [text, month, year] of [
    ['EXAMINATION PERIOD: December 2025', 12, 2025],
    ['Examination Period: June 2026', 6, 2026],
    ['EXAMINATION PERIOD - May 2026', 5, 2026],
    ['June 2026 EXAMINATION', 6, 2026]
  ]) assert.deepEqual(period.parseText(text), { exam_start_month: month, exam_start_year: year, exam_end_month: month, exam_end_year: year });
  const document = { raw_text: 'EXAMINATION PERIOD: December 2025' };
  const selected = { exam_start_month: 6, exam_start_year: 2026, exam_end_month: 6, exam_end_year: 2026 };
  assert.equal(integrity.contextChecks(document, selected).find(c => c.field === 'Examination period').status, 'MISMATCH');
  assert.ok(integrity.originalDocumentErrors({ document_evidence: document }, selected,
    { usn: 'TEST' }, { exam_type: 'REGULAR', attempt_no: 1 }, true, false).length > 0);
  assert.equal(period.parseText('Announced / Updated on June 2026'), null);
});

test('formats single-month, same-year and cross-year examination periods', () => {
  assert.equal(period.format({ exam_start_month: 4, exam_start_year: 2026, exam_end_month: 4, exam_end_year: 2026 }), 'Apr 2026');
  assert.equal(period.format({ exam_start_month: 5, exam_start_year: 2026, exam_end_month: 6, exam_end_year: 2026 }), 'May / Jun 2026');
  assert.equal(period.format({ exam_start_month: 12, exam_start_year: 2025, exam_end_month: 1, exam_end_year: 2026 }), 'Dec 2025 / Jan 2026');
});

test('normalizes period identity and rejects reverse ranges', () => {
  const crossYear = { exam_start_month: 'December', exam_start_year: '2025', exam_end_month: 'Jan', exam_end_year: 2026 };
  assert.equal(period.key(crossYear), '2025-12-2026-1');
  assert.equal(policy.periodKey(crossYear), '2025-12-2026-1');
  assert.equal(period.normalize({ exam_start_month: 6, exam_start_year: 2026, exam_end_month: 5, exam_end_year: 2026 }), null);
});

test('extracts full examination periods while ignoring announcement dates', () => {
  assert.deepEqual(period.parseText('December-2025 / January-2026 EXAMINATION'), {
    exam_start_month: 12, exam_start_year: 2025, exam_end_month: 1, exam_end_year: 2026
  });
  assert.deepEqual(period.parseText('May / June-2026 EXAMINATION'), {
    exam_start_month: 5, exam_start_year: 2026, exam_end_month: 6, exam_end_year: 2026
  });
  assert.deepEqual(period.parseText('DECEMBER 2025 / JANUARY 2026'), {
    exam_start_month: 12, exam_start_year: 2025, exam_end_month: 1, exam_end_year: 2026
  });
  assert.equal(period.parseText('Results announced on 15-02-2026'), null);
});

test('server validates structured periods and derives legacy compatibility columns', () => {
  const validate = sessionController._test.validateSessionFields;
  const single = validate({ semester: '01', exam_start_month: 'April', exam_start_year: '2026' });
  assert.deepEqual(single.errors, []);
  assert.equal(single.semester, '1');
  assert.equal(single.exam_end_month, 4);
  assert.equal(single.exam_session, 'Apr');
  assert.equal(single.exam_year, 2026);
  const invalid = validate({ semester: '1', exam_start_month: 6, exam_start_year: 2026,
    spans_multiple_months: true, exam_end_month: 5, exam_end_year: 2026 });
  assert.match(invalid.errors.join(' '), /cannot be before/);
});

test('session UI parses named month options and keeps modal actions above the page footer', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/js/sessions.js'), 'utf8');
  const sessionCss = fs.readFileSync(path.join(__dirname, '../public/css/sessions.css'), 'utf8');
  const responsiveCss = fs.readFileSync(path.join(__dirname, '../public/css/workspace-responsive.css'), 'utf8');
  assert.match(script, /ExamPeriod\.month\(document\.getElementById\(prefix \+ 'StartMonth'\)\.value\)/);
  assert.match(script, /ExamPeriod\.month\(document\.getElementById\(prefix \+ 'EndMonth'\)\.value\)/);
  assert.doesNotMatch(script, /Number\(document\.getElementById\(prefix \+ 'StartMonth'\)\.value\)/);
  assert.match(sessionCss, /\.sessions-modal \.modal-content > form[^{]*\{[^}]*display:\s*flex/);
  assert.match(sessionCss, /\.sessions-modal \.modal-footer[^{]*\{[^}]*flex:\s*0 0 auto/);
  assert.match(responsiveCss, /body\.modal-open > \.footer\s*\{\s*z-index:\s*0/);
});
