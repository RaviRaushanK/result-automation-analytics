'use strict';
/**
 * test-revaluation-row.js
 * Unit tests for parseRevaluationDetails() row-parsing logic.
 *
 * Covers:
 *   A. Clean pipe-separated row
 *   B. Actual OCR-garbled row (&} = F, stray 1 = misread P)
 *   C. Clean space-separated row (no pipes)
 *   D. Different subject code
 *   E. Multiple rows in sequence
 *   F. Partial row with unknown status
 *   G. OCR garble variants (&, }, &{)
 *
 * Run:  node scripts/test-revaluation-row.js
 * Exit: 0 = all pass, 1 = any failure
 */

const DE = require('../services/documentExtractor');

let pass = 0, fail = 0;

function r(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else     { fail++; console.error(`  FAIL  ${label}`); console.error(`         got:      ${JSON.stringify(got)}`); console.error(`         expected: ${JSON.stringify(want)}`); }
}

function row(input, expected) {
  // Derive the subject code from the first whitespace-delimited token.
  // (input may or may not contain pipes.)
  const codeMatch = input.match(/^\s*([A-Za-z0-9]+)/);
  const code  = codeMatch ? codeMatch[1] : '';
  const got   = DE.parseRevaluationDetails(code, input);

  r(`subjectCode    = ${expected.subjectCode}`,   got.subjectCode,    expected.subjectCode);
  r(`subjectName    = ${expected.subjectName || '(empty)'}`, got.subjectName, expected.subjectName || '');
  r(`internalMarks  = ${expected.internalMarks}`, got.internalMarks,  expected.internalMarks);
  r(`oldMarks       = ${expected.oldMarks}`,      got.oldMarks,       expected.oldMarks);
  r(`oldResult      = ${expected.oldResult}`,     got.oldResult,      expected.oldResult);
  r(`rvMarks        = ${expected.rvMarks}`,       got.rvMarks,        expected.rvMarks);
  r(`rvResult       = ${expected.rvResult}`,      got.rvResult,       expected.rvResult);
  r(`finalMarks     = ${expected.finalMarks}`,    got.finalMarks,     expected.finalMarks);
  r(`finalResult    = ${expected.finalResult}`,   got.finalResult,    expected.finalResult);
  r(`marksValidated = ${expected.marksValidated}`, got.marksValidated, expected.marksValidated);
  r(`rawLine        preserved`,                   got.rawLine,         input);
  console.log();
}

console.log('=== A. Clean pipe-separated row ===');
row(
  'MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
  { subjectCode:'MMC105', subjectName:'WEB TECHNOLOGIES', internalMarks:30, oldMarks:15, oldResult:'F',
    rvMarks:20, rvResult:'P', finalMarks:20, finalResult:'P', marksValidated:true }
);

console.log('=== B. Actual OCR-garbled row (&} = F, 1 = misread P) ===');
row(
  'MMC105 | WEB TECHNOLOGIES 30 15 &} 20 1 20 P',
  { subjectCode:'MMC105', subjectName:'WEB TECHNOLOGIES', internalMarks:30, oldMarks:15, oldResult:'F',
    rvMarks:20, rvResult:'P', finalMarks:20, finalResult:'P', marksValidated:true }
);

console.log('=== C. Clean space-separated row (no pipes) ===');
row(
  'MMC105 WEB TECHNOLOGIES 30 15 F 20 P 20 P',
  { subjectCode:'MMC105', subjectName:'WEB TECHNOLOGIES', internalMarks:30, oldMarks:15, oldResult:'F',
    rvMarks:20, rvResult:'P', finalMarks:20, finalResult:'P', marksValidated:true }
);

console.log('=== D. Different subject code ===');
row(
  '18CS51 | DATABASE SYSTEMS | 25 | 35 | P | 45 | P | 45 | P',
  { subjectCode:'18CS51', subjectName:'DATABASE SYSTEMS', internalMarks:25, oldMarks:35, oldResult:'P',
    rvMarks:45, rvResult:'P', finalMarks:45, finalResult:'P', marksValidated:true }
);

console.log('=== E. Multiple revaluation rows (sequential calls) ===');
const e1 = DE.parseRevaluationDetails('MMC105', 'MMC105 | WEB TECHNOLOGIES 30 15 &} 20 1 20 P');
const e2 = DE.parseRevaluationDetails('MMC106', 'MMC106 | COMPUTER NETWORKS 40 38 &} 42 1 42 P');
r('row1 rvMarks',     e1.rvMarks,    20);
r('row1 rvResult',    e1.rvResult,   'P');
r('row1 finalMarks',  e1.finalMarks, 20);
r('row1 finalResult', e1.finalResult,'P');
r('row2 rvMarks',     e2.rvMarks,    42);
r('row2 rvResult',    e2.rvResult,   'P');
r('row2 finalMarks',  e2.finalMarks, 42);
r('row2 finalResult', e2.finalResult,'P');
console.log();

console.log('=== F. Garbled field — X (unknown status, preserved as raw) ===');
const f = DE.parseRevaluationDetails('MMC105', 'MMC105 | WEB TECHNOLOGIES 30 15 &} 20 X 20 P');
r('F: rvResult=X',    f.rvResult,    'X');
r('F: rvResultRaw=X', f.rvResultRaw, 'X');
r('F: finalResult=P', f.finalResult, 'P');
r('F: marksValidated', f.marksValidated, true);
console.log();

console.log('=== G. OCR garble variants ===');
// All map to F → expect oldResult=F, rvResult=P, finalResult=P
[
  { garble: '&{', label: '&{ for F' },
  { garble: '}',  label: '} alone for F' },
  { garble: '&',  label: 'bare & for F' },
  { garble: '&}', label: '&} for F' }
].forEach(({ garble, label }) => {
  const input = `MMC105 | WEB TECHNOLOGIES 30 15 ${garble} 20 1 20 P`;
  const got = DE.parseRevaluationDetails('MMC105', input);
  r(`G[${label}]: oldResult=F`,  got.oldResult,  'F');
  r(`G[${label}]: rvResult=P`,   got.rvResult,   'P');
  r(`G[${label}]: finalResult=P`,got.finalResult,'P');
  console.log();
});

console.log('=== H. looksLikeRevaluationRow detector ===');
r('H: clean pipe row is true', DE.looksLikeRevaluationRow('MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P'), true);
r('H: OCR garbled row is true', DE.looksLikeRevaluationRow('MMC105 | WEB TECHNOLOGIES 30 15 &} 20 1 20 P'), true);
r('H: SE038 header is false',  DE.looksLikeRevaluationRow('Form No. SE038  VTU Revaluation'), false);
r('H: bare FA2003 is false',   DE.looksLikeRevaluationRow('FA2003'), false);

// PART A/F NEW: ≥4 threshold — form header with number + date must NOT be a row.
// "FA2003" (form number "2003") + date "2026-04-28" has only 1 real token ("2026")
// so it must return false.
r('H: FA2003 + date threshold >=4: false', DE.looksLikeRevaluationRow('Application Ref: FA2003  2026-04-28'), false);
// Single-code with no marks: false regardless of threshold.
r('H: Form with SE038 only: false', DE.looksLikeRevaluationRow('Form No. SE038  VTU Revaluation Form'), false);
// VTU-style form with 3 numbers only (date alone doesn't reach 4):
r('H: Form with 3 numbers (not marks): false', DE.looksLikeRevaluationRow('SE038  Form 2026 04 28'), false);
console.log();

console.log('=== I. parseProductionData — table-bound subject detection ===');
// FA2003 is a form reference, not a subject. With ≥4 threshold it must be excluded.
const i1 = DE.parseProductionData(
  'Form No. FA2003  VTU Revaluation\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
  [], 'revaluation'
);
r('I: FA2003 NOT in subjects', i1.subjects.some(s => s.subjectCode === 'FA2003'), false);
r('I: MMC105 IS in subjects',  i1.subjects.some(s => s.subjectCode === 'MMC105'), true);
r('I: subjects.length=1', i1.subjects.length, 1);

// Form with SE038 header, real subject on next line.
const i2 = DE.parseProductionData(
  'Form No. SE038  VTU Revaluation Form\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
  [], 'revaluation'
);
r('I2: SE038 NOT in subjects', i2.subjects.some(s => s.subjectCode === 'SE038'), false);
r('I2: MMC105 IS in subjects',  i2.subjects.some(s => s.subjectCode === 'MMC105'), true);
r('I2: subjects.length=1', i2.subjects.length, 1);

// FAZ003-like form reference mixed with real subject (FAZ003 won't match regex anyway).
const i3 = DE.parseProductionData(
  'Application Ref: FAZ003  Revaluation\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
  [], 'revaluation'
);
r('I3: FAZ003 NOT in subjects (regex rejects FAZ003)', i3.subjects.some(s => s.subjectCode === 'FAZ003'), false);
r('I3: MMC105 IS in subjects',  i3.subjects.some(s => s.subjectCode === 'MMC105'), true);
r('I3: subjects.length=1', i3.subjects.length, 1);

// Noisy PDF with multiple form references + date on same line as subject.
const i4 = DE.parseProductionData(
  'SE038  FA2003  2026  Form  Card\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
  [], 'revaluation'
);
r('I4: SE038 NOT in subjects', i4.subjects.some(s => s.subjectCode === 'SE038'), false);
r('I4: FA2003 NOT in subjects', i4.subjects.some(s => s.subjectCode === 'FA2003'), false);
r('I4: MMC105 IS in subjects',  i4.subjects.some(s => s.subjectCode === 'MMC105'), true);
r('I4: subjects.length=1', i4.subjects.length, 1);
console.log();

console.log('============================================================');
console.log(`Revaluation Row: ${pass}/${pass + fail} PASS`);
console.log('============================================================');
if (fail > 0) process.exit(1);
