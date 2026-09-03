'use strict';
var RE = require('../services/revaluationExtractor');
var path = require('path');
var fs = require('fs');

function mockServerCtx(o) { o = o || {}; return { studentUsn: o.studentUsn || '1MV25MC074', studentName: o.studentName || 'SINDHUKUMAR S', allSubjectResults: [{ subject_result_id: 1, subject_code: 'MMC105', subject_name: 'WEB TECHNOLOGIES', credits: 4, marks: 30, result_status: 'FAIL', grade: 'F' }] }; }

// Standalone: compare usn_normalized to server USN
function usnStatusStandalone(usnNormalized, serverUsn) {
  usnNormalized = usnNormalized || '';
  if (!usnNormalized) return null;
  serverUsn = String(serverUsn || '');
  return usnNormalized === serverUsn ? 'EXACT_MATCH' : 'MISMATCH';
}

// Controller-style: uses usn_normalized AND raw usn to distinguish EXACT_MATCH vs MATCH_AFTER_NORMALIZATION
function usnStatusController(ocrCandidates, serverUsn) {
  var normU = (ocrCandidates && ocrCandidates.usn_normalized) || null;
  if (!normU) return null;
  var serverU = String(serverUsn || '');
  if (normU === serverU) {
    var rawU = (ocrCandidates && ocrCandidates.usn) || '';
    if (rawU && rawU !== normU) return 'MATCH_AFTER_NORMALIZATION';
    return 'EXACT_MATCH';
  }
  return 'MISMATCH';
}

function latestPdf() {
  var dir = path.resolve(__dirname, '../uploads/revaluation');
  var files = fs.readdirSync(dir).filter(function(f){ return f.endsWith('.pdf') && !f.startsWith('__'); }).sort().reverse();
  return path.resolve(dir, files[0]);
}

var passed = 0, failed = 0;
function T(label, got, expected) {
  if (got === expected) { passed++; console.log('  PASS  ' + label + '  (' + JSON.stringify(got) + ')'); }
  else { failed++; console.log('  FAIL  ' + label); console.log('         expected: ' + JSON.stringify(expected) + '  got: ' + JSON.stringify(got)); }
}
function section(name) { console.log('\n[' + name + ']'); }

section('USN status standalone (usn_normalized -> server USN)');
T('EXACT_MATCH: 1MV25MC074 vs 1MV25MC074', usnStatusStandalone('1MV25MC074', '1MV25MC074'), 'EXACT_MATCH');
T('MISMATCH: 1MV25MC075 vs 1MV25MC074', usnStatusStandalone('1MV25MC075', '1MV25MC074'), 'MISMATCH');
T('MISMATCH: 1MV25MC076 vs 1MV25MC074', usnStatusStandalone('1MV25MC076', '1MV25MC074'), 'MISMATCH');
T('null: empty', usnStatusStandalone('', '1MV25MC074'), null);
T('null: null', usnStatusStandalone(null, '1MV25MC074'), null);

section('USN status controller (usn_normalized + raw usn)');
T('EXACT_MATCH: no I/O drift', usnStatusController({usn:'1MV25MC074',usn_normalized:'1MV25MC074'}, '1MV25MC074'), 'EXACT_MATCH');
T('MATCH_AFTER_NORMAL: I/O drift', usnStatusController({usn:'IMV25MCO074',usn_normalized:'1MV25MC074'}, '1MV25MC074'), 'MATCH_AFTER_NORMALIZATION');
T('MISMATCH: genuine diff', usnStatusController({usn:'1MV25MC075',usn_normalized:'1MV25MC075'}, '1MV25MC074'), 'MISMATCH');
T('null: no usn_normalized', usnStatusController({usn:'IMV25MC074',usn_normalized:null}, '1MV25MC074'), null);

section('Real PDF: OCR correction case (I->1)');
var PDF = latestPdf();
console.log('  PDF: ' + path.basename(PDF));

RE.extractAndBuild(PDF, mockServerCtx()).then(function(r) {
  var ocr = r.ocr || {};
  var sc = ocr.student_candidates || {};
  T('Real PDF: raw USN = IMV25MCO074', sc.usn, 'IMV25MCO074');
  T('Real PDF: usn_normalized = 1MV25MC074', sc.usn_normalized, '1MV25MC074');
  T('Real PDF: usn_matches_server = true', sc.usn_matches_server, true);
  T('Real PDF: name_matches_server = true', sc.name_matches_server, true);
  T('Real PDF: name = SINDHUKUMAR S', sc.name, 'SINDHUKUMAR S');
  T('Real PDF: controller usnStatus = MATCH_AFTER_NORMALIZATION', usnStatusController(sc, '1MV25MC074'), 'MATCH_AFTER_NORMALIZATION');
  T('Real PDF: subjects.length = 1', ocr.subjects.length, 1);
  T('Real PDF: subject[0].subjectCode = MMC105', ocr.subjects[0] ? ocr.subjects[0].subjectCode : null, 'MMC105');
  T('Real PDF: subject[0].rvMarks = 20', ocr.subjects[0] ? ocr.subjects[0].rvMarks : null, 20);
  T('Real PDF: subject[0].match_state = MATCHED', ocr.subjects[0] ? ocr.subjects[0].match_state : null, 'MATCHED');
  T('Real PDF: no SE038 phantom', !ocr.subjects.some(function(s){ return s.subjectCode === 'SE038'; }), true);
  T('Real PDF: no FAZ003 phantom', !ocr.subjects.some(function(s){ return s.subjectCode === 'FAZ003'; }), true);
  T('Real PDF: unmatched_ocr_codes = []', JSON.stringify(ocr.unmatched_ocr_codes || []), '[]');

  section('Name mismatch: USN matches (after normalization), name differs');
  return RE.extractAndBuild(PDF, mockServerCtx({ studentName: 'WRONG NAME X' }));
}).then(function(r) {
  var sc = r.ocr.student_candidates || {};
  T('Name mismatch: usn_matches_server = true', sc.usn_matches_server, true);
  T('Name mismatch: name_matches_server = false', sc.name_matches_server, false);
  T('Name mismatch: usnStatus = MATCH_AFTER_NORMALIZATION', usnStatusController(sc, '1MV25MC074'), 'MATCH_AFTER_NORMALIZATION');

  section('Genuine USN mismatch: different USN, same name');
  return RE.extractAndBuild(PDF, mockServerCtx({ studentUsn: '1MV25MC075' }));
}).then(function(r) {
  var sc = r.ocr.student_candidates || {};
  T('Genuine mismatch: usn_matches_server = false', sc.usn_matches_server, false);
  T('Genuine mismatch: name_matches_server = true', sc.name_matches_server, true);
  T('Genuine mismatch: usnStatus = MISMATCH', usnStatusController(sc, '1MV25MC075'), 'MISMATCH');

  console.log('\n============================================================');
  console.log('Identity Status: ' + passed + '/' + (passed + failed) + ' PASS');
  console.log('============================================================');
  process.exit(failed > 0 ? 1 : 0);
}).catch(function(e) { console.error(e); process.exit(1); });
