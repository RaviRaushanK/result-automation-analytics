'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, 'config/.env') });
const path = require('path');
const DE = require('./services/documentExtractor');

const PDF = path.resolve(__dirname,
  'uploads/revaluation/reval_1788440425398_SINDU_REV__1__aax1yi.pdf');

(async () => {
  const docResult = await DE.extract(PDF, 'revaluation');
  const rawText = docResult.extraction.rawText;
  console.log('=== ACTUAL RAW TEXT (JSON-escaped) ===');
  console.log(JSON.stringify(rawText));
  console.log();

  const idx = rawText.indexOf('Student Name');
  console.log('--- "Student Name" @', idx, '---');
  console.log(JSON.stringify(rawText.substring(idx, idx + 60)));
  console.log();

  const boundary = '(?=\\s*(?:\\n|\\r\\n|\\s+(?:Semester|Sem|USN|University|Seat|Father|Mother|College|Result|Exam|Date|Roll|Subject|Code|Page|Year)\\b|$))';

  // Test: which label, what capture?
  for (const label of ['Student Name', 'Name']) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '\\s*[:\\-]*\\s*([A-Za-z][A-Za-z\\s.\'-]{0,80}?)' + boundary, 'i');
    const m = rawText.match(re);
    console.log('--- ' + label + ' ---');
    console.log('  Match:', JSON.stringify(m ? m[1] : null));
  }

  // The actual problem: "SINDHUKUMAR S 4 G EEE" - non-greedy matches through it because G and EEE are letters.
  // The current code goes through labelVariants: StudentName first, then 'Name'.
  // 'Name' is short and will match the table header "Name Internal..." too early in the document.
  // We must add: capture MUST NOT contain digits.
  console.log();
  console.log('=== STRATEGY: filter out captures with digits ===');

  function isValidName(val) {
    if (!val) return false;
    if (/[0-9]/.test(val)) return false;
    if (isTableHeader(val)) return false;
    if (/\s{2,}/.test(val)) return false;  // multiple spaces = OCR noise
    return true;
  }

  const tableHeaderKeywords = ['internal', 'external', 'total', 'obtained', 'result',
    'status', 'marks', 'theory', 'practical', 'lab',
    'subject', 'code', 'sessional', 'semester'];
  function isTableHeader(val) {
    const lower = val.toLowerCase();
    return tableHeaderKeywords.some(k => lower.indexOf(k) !== -1);
  }

  const candidates = [
    'SINDHUKUMAR S 4 G EEE',
    'SINDHUKUMAR S',
    'Internal old ol RV RV Final Final',
    'Subject Subject Name',
    'JOHN KUMAR',
    'JOHN  KUMAR',
    'Subject Code Subject Name Internal',
  ];
  candidates.forEach(c => {
    console.log('  "' + c + '" isValid=' + isValidName(c));
  });
})();
