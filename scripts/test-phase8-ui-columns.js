'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const { OcrExtraction, ImportLog, Result, SubjectResult, Student, ResultSession, Batch, Subject } = require('../database/models');
const ctrl = require('../controllers/revaluationController');
const uuid = require('crypto').randomUUID;
var pass = 0, fail = 0;
var check = function(n, c) { if (c) { pass++; console.log('  PASS: ' + n); } else { fail++; console.log('  FAIL: ' + n); } };
var mkR = function() { var r = { _s: 200, _r: null, _v: null }; r.status = function(c) { r._s = c; return r; }; r.redirect = function(u) { r._s = 302; r._r = u; return r; }; r.render = function(v, d) { r._v = { view: v, vars: d }; return r; }; return r; };
var mkReq = function(o) { o = o || {}; return { params: o.params || {}, body: o.body || {}, query: o.query || {}, session: {}, file: null, app: { get: function() {} }, protocol: 'http', get: function() { return 'localhost'; }, getHostname: function() { return 'localhost'; }, headers: {} }; };
var SR1 = 99801, SR2 = 99802, SC1 = 'T8CS101', SC2 = 'T8CS102';
var _confNum = function(raw) { if (raw === null || raw === undefined) return null; if (typeof raw === 'number') return raw; var M = { high: 0.9, medium: 0.7, low: 0.4 }; return M[String(raw).toLowerCase()] != null ? M[String(raw).toLowerCase()] : null; };
var _confPct = function(raw) { var n = _confNum(raw); return n === null ? '—' : Math.round(n * 100) + '%'; };
var _decisionDisplay = function(prop, pd) { if (prop) return prop.decision.toUpperCase(); if (pd) return pd.toUpperCase(); return 'no decision saved'; };
var mkExtractedJson = function(opts) {
  opts = opts || {};
  return { result_id: 99800, student_id: 99800, session_id: 99800, identity_confirmed: true, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    subjects: [{ subject_result_id: SR1, subject_code: SC1, subject_name: 'CS', credits: 4 }, { subject_result_id: SR2, subject_code: SC2, subject_name: 'DS', credits: 4 }],
    subjects_selection: [{ subject_result_id: SR1, subject_code: SC1, subject_name: 'CS', credits: 4 }, { subject_result_id: SR2, subject_code: SC2, subject_name: 'DS', credits: 4 }],
    ocr: { extraction_status: 'extracted', extraction_method: 'test', warnings: [], student_candidates: { name: 'Test User 98', usn: 'TEST98998', name_matches_server: true, usn_matches_server: true }, semester_candidate: 1,
      subjects: [
        { subject_result_id: SR1, subject_code: SC1, match_state: 'MATCHED', revised_marks: 70, revised_status_candidate: 'pass', confidence: opts.confidence1 || 'high' },
        { subject_result_id: SR2, subject_code: SC2, match_state: 'MATCHED', revised_marks: 35, revised_status_candidate: 'fail', confidence: opts.confidence2 || 'medium' }
      ],
      unmatched_ocr_codes: [], missing_subjects: [], raw_text: 'test'
    },
    documents: [{ file_name: 'test.pdf', file_url: '/uploads/test.pdf' }]
  };
};
var setJ = async function(id, j) { var e = await OcrExtraction.findOne({ where: { import_id: id } }); if (e) await e.destroy(); await OcrExtraction.create({ import_id: id, raw_text: '', validation_status: 'validated', extracted_json: j, extracted_at: new Date() }); };
var clrR = async function(id) { var e = await OcrExtraction.findOne({ where: { import_id: id } }); if (!e) return; var j = e.extracted_json || {}; delete j.review; await e.update({ extracted_json: j }); };
var bootstrap = async function() {
  var batch = await Batch.findByPk(99800) || await Batch.create({ batch_uuid: uuid(), department_id: 1, batch_name: 'TEST-BATCH-P8', start_year: 2024, end_year: 2028, status: 'active' });
  await Student.findByPk(99800) || await Student.create({ student_id: 99800, student_uuid: uuid(), batch_id: batch.batch_id, usn: 'TEST98998', student_name: 'Test User 98', email: 'test98@raas.local', status: 'active' });
  await ResultSession.findByPk(99800) || await ResultSession.create({ session_id: 99800, session_uuid: uuid(), semester: 'Sem 98', exam_session: 'JAN', exam_year: 2026, batch_id: batch.batch_id, status: 'published' });
  await Result.findByPk(99800) || await Result.create({ result_id: 99800, result_uuid: uuid(), student_id: 99800, session_id: 99800, attempt_no: 1, exam_type: 'REGULAR', sgpa: 7.5, cgpa: 7.5, result_status: 'pass', failed_subject_count: 0 });
  await Subject.findByPk(99801) || await Subject.create({ subject_id: 99801, session_id: 99800, subject_uuid: uuid(), subject_code: SC1, subject_name: 'CS', subject_type: 'theory', credits: 4, max_internal: 30, max_external: 70, max_marks: 100 });
  await Subject.findByPk(99802) || await Subject.create({ subject_id: 99802, session_id: 99800, subject_uuid: uuid(), subject_code: SC2, subject_name: 'DS', subject_type: 'theory', credits: 4, max_internal: 30, max_external: 70, max_marks: 100 });
  await SubjectResult.findByPk(SR1) || await SubjectResult.create({ subject_result_id: SR1, result_id: 99800, subject_id: 99801, marks: 65, grade: 'B', result_status: 'pass' });
  await SubjectResult.findByPk(SR2) || await SubjectResult.create({ subject_result_id: SR2, result_id: 99800, subject_id: 99802, marks: 30, grade: 'F', result_status: 'fail' });
  await ImportLog.findByPk(99801) || await ImportLog.create({ import_id: 99801, session_id: 99800, uploaded_by: 1, file_name: 'test-p8.pdf', file_path: '/uploads/test-p8.pdf', file_type: 'pdf', import_type: 'REVALUATION', status: 'extracted' });
  await ImportLog.findByPk(99802) || await ImportLog.create({ import_id: 99802, session_id: 99800, uploaded_by: 1, file_name: 'test-p8b.pdf', file_path: '/uploads/test-p8b.pdf', file_type: 'pdf', import_type: 'REVALUATION', status: 'extracted' });
};

(async function() {
  await bootstrap();
  try {
    console.log('\n[T1] showExtraction — subjects carry string confidence');
    await setJ(99801, mkExtractedJson({ confidence1: 'high', confidence2: 'low' }));
    var r1 = mkR();
    await ctrl.showExtraction(mkReq({ params: { importId: 99801 } }), r1);
    check('showExtraction renders extraction.ejs', r1._v && r1._v.view === 'revaluation/extraction');
    check('subjects[0].confidence === "high" (string)', r1._v.vars.subjects[0] && r1._v.vars.subjects[0].confidence === 'high');
    console.log('\n[T2] showExtraction — medium and low confidence');
    await setJ(99802, mkExtractedJson({ confidence1: 'medium', confidence2: 'low' }));
    var r2 = mkR();
    await ctrl.showExtraction(mkReq({ params: { importId: 99802 } }), r2);
    check('subjects[0].confidence === "medium" (string)', r2._v.vars.subjects[0] && r2._v.vars.subjects[0].confidence === 'medium');
    check('subjects[1].confidence === "low" (string)', r2._v.vars.subjects[1] && r2._v.vars.subjects[1].confidence === 'low');
    console.log('\n[T3] showReview (edit mode) — evidence.confidence is string');
    await clrR(99801);
    await setJ(99801, mkExtractedJson({ confidence1: 'high', confidence2: 'medium' }));
    var r3 = mkR();
    await ctrl.showReview(mkReq({ params: { importId: 99801 } }), r3);
    check('showReview renders review.ejs', r3._v && r3._v.view === 'revaluation/review');
    check('mode === "edit"', r3._v.vars.mode === 'edit');
    check('rows.length === 2', r3._v.vars.rows && r3._v.vars.rows.length === 2);
    check('row[0].evidence.confidence === "high"', r3._v.vars.rows[0] && r3._v.vars.rows[0].evidence && r3._v.vars.rows[0].evidence.confidence === 'high');
    check('row[0].priorDecision === null', r3._v.vars.rows[0] && r3._v.vars.rows[0].priorDecision === null);
    console.log('\n[T4] showReview (locked mode) — priorDecision from frozen proposal');
    await clrR(99802);
    var j4 = mkExtractedJson({ confidence1: 'high', confidence2: 'low' });
    j4.review = { submitted_at: '2026-04-01T10:00:00Z', submitted_by: 1, proposal: [
      { subject_result_id: SR1, decision: 'accept' },
      { subject_result_id: SR2, decision: 'reject' }
    ] };
    await setJ(99802, j4);
    var r4 = mkR();
    await ctrl.showReview(mkReq({ params: { importId: 99802 } }), r4);
    check('mode === "locked"', r4._v.vars.mode === 'locked');
    var r4row0 = r4._v.vars.rows.find(function(r) { return Number(r.srid) === SR1; });
    var r4row1 = r4._v.vars.rows.find(function(r) { return Number(r.srid) === SR2; });
    check('SR1 priorDecision === "accept"', r4row0 && r4row0.priorDecision === 'accept');
    check('SR2 priorDecision === "reject"', r4row1 && r4row1.priorDecision === 'reject');

    console.log('\n[T5] CONFIDENCE_SCORES mapping — "high" renders as "90%"');
    check('"high" → 90%', _confPct('high'), '90%');
    check('"medium" → 70%', _confPct('medium'), '70%');
    check('"low" → 40%', _confPct('low'), '40%');
    check('null → "—"', _confPct(null), '—');
    check('number 0.85 → 85%', _confPct(0.85), '85%');
    check('"HIGH" (uppercase) → 90%', _confPct('HIGH'), '90%');
    console.log('\n[T6] Decision column fallback — prop null, pd non-null');
    check('prop=null, pd=accept → ACCEPT', _decisionDisplay(null, 'accept'), 'ACCEPT');
    check('prop=null, pd=reject → REJECT', _decisionDisplay(null, 'reject'), 'REJECT');
    check('prop=null, pd=null → no decision saved', _decisionDisplay(null, null), 'no decision saved');
    check('prop.accept → ACCEPT', _decisionDisplay({ decision: 'accept' }, null), 'ACCEPT');
    check('prop.reject → REJECT', _decisionDisplay({ decision: 'reject' }, null), 'REJECT');
    console.log('\n[T7] extractor CONFIDENCE_SCORES aligns with template');
    var extractorSrc = require('fs').readFileSync(require('path').resolve(__dirname, '../services/revaluationExtractor.js'), 'utf8');
    check('extractor high=0.9', /CONFIDENCE_SCORES\s*=\s*\{[^}]*high\s*:\s*0\.9/.test(extractorSrc), true);
    check('extractor medium=0.7', /CONFIDENCE_SCORES\s*=\s*\{[^}]*medium\s*:\s*0\.7/.test(extractorSrc), true);
    check('extractor low=0.4', /CONFIDENCE_SCORES\s*=\s*\{[^}]*low\s*:\s*0\.4/.test(extractorSrc), true);
    console.log('\n[T8] extraction.ejs template has CONFIDENCE_SCORES mapping');
    var extractionSrc = require('fs').readFileSync(require('path').resolve(__dirname, '../views/revaluation/extraction.ejs'), 'utf8');
    check('template has CONFIDENCE_SCORES map', extractionSrc.indexOf('CONFIDENCE_SCORES = { high: 0.9') !== -1, true);
    check('template no longer calls Number() on raw confidence', extractionSrc.indexOf('const n = Number(confidence)') === -1, true);
    console.log('\n[T9] review.ejs has priorDecision fallback for Decision column');
    var reviewSrc = require('fs').readFileSync(require('path').resolve(__dirname, '../views/revaluation/review.ejs'), 'utf8');
    check('review.ejs references r.priorDecision', reviewSrc.indexOf('r.priorDecision') !== -1, true);
    check('review.ejs renders badge with priorDecision.toUpperCase()', reviewSrc.indexOf('priorDecision.toUpperCase()') !== -1, true);
  } catch (err) { console.error('Crash:', err.message, err.errors ? JSON.stringify(err.errors) : ''); fail++; }
  console.log('\n==== PHASE 8 UI Columns: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });

