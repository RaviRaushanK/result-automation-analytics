'use strict';
// Clear cached modules so the latest controller code is used (no stale require cache).
Object.keys(require.cache).forEach(k => {
  if (k.includes('revaluationController') || k.includes('database\\models') || k.includes('database/models')) {
    delete require.cache[k];
  }
});
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });

const crypto = require('crypto');
const path   = require('path');
const fs2    = require('fs');
const db     = require('../database/models');
const { Batch, ResultSession, Student, Result, Subject, SubjectResult, ImportLog, OcrExtraction, AdminUser } = db;
const ctrl   = require('../controllers/revaluationController');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  PASS:', n); } else { fail++; console.log('  FAIL:', n); } };
function mkRes() {
  const r = { _status: 200, _redirectTo: null, _rendered: null, _json: null };
  r.status = c => { r._status = c; return r; };
  r.redirect = u => { r._redirectTo = u; return r; };
  r.render = (v, vars) => { r._rendered = { view: v, vars }; return r; };
  r.json = o => { r._json = o; return r; };
  return r;
}
function mkReq(o = {}) {
  return { params: o.params||{}, body: o.body||{}, query: o.query||{}, session: o.session||{}, file: o.file||null, app:{get:()=>undefined}, protocol:'http', get:()=>'localhost', headers:{} };
}
async function cleanupFixtures(ids) {
  try { if (ids.ocrId)    await OcrExtraction.destroy({ where: { extraction_id: ids.ocrId } }); } catch (_) {}
  try { if (ids.importId) await ImportLog.destroy({ where: { import_id: ids.importId } }); } catch (_) {}
  try { if (ids.srIds && ids.srIds.length) await SubjectResult.destroy({ where: { subject_result_id: ids.srIds } }); } catch (_) {}
  try { if (ids.resultId) await Result.destroy({ where: { result_id: ids.resultId } }); } catch (_) {}
  try { if (ids.subjectIds && ids.subjectIds.length) await Subject.destroy({ where: { subject_id: ids.subjectIds } }); } catch (_) {}
  try { if (ids.studentId) await Student.destroy({ where: { student_id: ids.studentId } }); } catch (_) {}
  try { if (ids.sessionId) await ResultSession.destroy({ where: { session_id: ids.sessionId } }); } catch (_) {}
  try { if (ids.batchId)   await Batch.destroy({ where: { batch_id: ids.batchId } }); } catch (_) {}
  try { if (ids.adminId)   await AdminUser.destroy({ where: { admin_id: ids.adminId } }); } catch (_) {}
}

async function buildFixtures() {
  const c = {};
  const stamp = Date.now().toString().slice(-6) + crypto.randomInt(1000, 9999);
  c.batch = await Batch.create({ batch_uuid: crypto.randomUUID(), department_id: 1, batch_name: '__RAAS_MR__', start_year: 2026, end_year: 2027, status: 'active' });
  c.session = await ResultSession.create({ session_uuid: crypto.randomUUID(), batch_id: c.batch.batch_id, semester: 'Sem MR', exam_session: 'NOV', exam_year: 2026 });
  c.student = await Student.create({ student_uuid: crypto.randomUUID(), batch_id: c.batch.batch_id, usn: 'MRT' + stamp, student_name: 'Mismatch Reprod', email: 'mr.' + stamp + '@raas.local', status: 'active' });
  const subj = await Subject.create({ session_id: c.session.session_id, subject_uuid: crypto.randomUUID(), subject_code: 'MRA_' + stamp, subject_name: 'Mathematics', subject_type: 'theory', credits: 4, max_internal: 50, max_external: 100, max_marks: 150 });
  c.result = await Result.create({ result_uuid: crypto.randomUUID(), student_id: c.student.student_id, session_id: c.session.session_id, attempt_no: 1, exam_type: 'REGULAR', sgpa: 7.0, cgpa: 7.0, result_status: 'pass', failed_subject_count: 0 });
  c.sr = await SubjectResult.create({ result_id: c.result.result_id, subject_id: subj.subject_id, marks: 90, grade: 'A', result_status: 'pass' });
  c.adminRow = await AdminUser.create({ admin_uuid: crypto.randomUUID(), username: '__raas_mr_admin__' + stamp, email: 'mradmin.' + stamp + '@raas.local', password_hash: 'x', role: 'admin', status: 'active' });
  const fp = path.resolve(__dirname, '../uploads/__raas_mr__.pdf');
  try { fs2.mkdirSync(path.dirname(fp), { recursive: true }); } catch (_) {}
  fs2.writeFileSync(fp, '%PDF-1.4\nfake\n%%EOF\n');
  const ocrSubject = { subject_result_id: c.sr.subject_result_id, subject_id: subj.subject_id, subject_code: 'MRA_' + stamp, subject_name: 'Mathematics', original_marks: 90, original_status: 'pass', ocr_subject_code: 'MRA_' + stamp, normalized_code: 'MRA' + stamp, match_state: 'MATCHED', revised_internal_marks: 88, revised_external_marks: 0, revised_marks: 88, revised_status_candidate: 'pass', confidence: 0.95, raw_line: 'OCR' };
  c.importLog = await ImportLog.create({ session_id: c.session.session_id, uploaded_by: c.adminRow.admin_id, file_name: '__raas_mr__.pdf', file_path: fp, file_type: 'pdf', import_type: 'REVALUATION', status: 'extracted' });
  c.ocr = await OcrExtraction.create({ import_id: c.importLog.import_id, raw_text: 'OCR_NAME_WRONG 1XX12345', confidence_score: 95, validation_status: 'pending', extracted_json: { result_id: c.result.result_id, student_id: c.student.student_id, session_id: c.session.session_id, attempt: { attempt_no: 1, exam_type: 'REGULAR' }, student: { usn: c.student.usn, name: c.student.student_name }, subjects: [ocrSubject], ocr: { extraction_status: 'extracted', extraction_method: 'stub', warnings: [], unmatched_ocr_codes: [], student_candidates: { usn: '1XX99999', name: 'Some Other Person' }, semester_candidate: 'Sem MR', subjects: [ocrSubject] }, documents: [{ file_name: '__raas_mr__.pdf', original_name: '__raas_mr__.pdf', url: '/uploads/__raas_mr__.pdf' }] } });
  c.ids = { batchId: c.batch.batch_id, sessionId: c.session.session_id, studentId: c.student.student_id, resultId: c.result.result_id, subjectIds: [subj.subject_id], srIds: [c.sr.subject_result_id], importId: c.importLog.import_id, ocrId: c.ocr.extraction_id, adminId: c.adminRow.admin_id };
  return c;
}

async function run() {
  console.log('\n=== BUG 1: Confirm Mismatch flow ===');
  const c1 = await buildFixtures();
  try {
    let r = mkRes();
    await ctrl.showExtraction(mkReq({ params: { importId: c1.importLog.import_id } }), r);
    const v1 = r._rendered && r._rendered.vars;
    if (!r._rendered) console.log('  showExtraction redirected to:', r._redirectTo);
    check('[1a] extraction rendered', r._rendered && r._rendered.view === 'revaluation/extraction');
    check('[1a] identityBlocking=true before confirm', v1 && v1.identityBlocking === true);
    check('[1a] identityConfirmed=false', v1 && v1.identityConfirmed === false);
    check('[1a] severity=mismatch', v1 && v1.identityCheck && v1.identityCheck.severity === 'mismatch');
    r = mkRes();
    await ctrl.confirmIdentity(mkReq({ params: { importId: c1.importLog.import_id } }), r);
    check('[1b] confirmIdentity redirected to extraction', r._redirectTo && r._redirectTo.includes('/revaluation/extraction/' + c1.importLog.import_id));
    const afterOcr = await OcrExtraction.findByPk(c1.ocr.extraction_id);
    const afterSaved = afterOcr ? (afterOcr.extracted_json || {}) : {};
    console.log('  DB probe: identity_confirmed =', afterSaved.identity_confirmed);
    r = mkRes();
    await ctrl.showExtraction(mkReq({ params: { importId: c1.importLog.import_id } }), r);
    const v2 = r._rendered && r._rendered.vars;
    if (!r._rendered) console.log('  showExtraction after-confirm redirected to:', r._redirectTo);
    check('[1c] identityBlocking=false after confirm', v2 && v2.identityBlocking === false);
    check('[1c] identityConfirmed=true', v2 && v2.identityConfirmed === true);
    check('[1c] logStatus=extracted', v2 && v2.logStatus === 'extracted');
    check('[1c] extractionStatus=extracted', v2 && v2.extractionStatus === 'extracted');
    r = mkRes();
    await ctrl.showReview(mkReq({ params: { importId: c1.importLog.import_id } }), r);
    check('[1d] showReview not blocked by identity error', !(r._redirectTo && /identity|confirm.*mismatch/i.test(r._redirectTo)));
  } finally { await cleanupFixtures(c1.ids); }
  console.log('\n=== BUG 2: Re-upload first click ===');
  const c2 = await buildFixtures();
  try {
    let threw = null;
    let r = mkRes();
    try { await ctrl.showUploadPage(mkReq({ params: { resultId: c2.result.result_id }, query: { replace: '1' }, session: {} }), r); } catch (e) { threw = e; }
    check('[2a] showUploadPage did NOT throw', !threw);
    check('[2a] no Assignment to constant variable', !threw || !/Assignment to constant variable/.test(threw.message || ''));
    check('[2a] upload page rendered (not 500)', r._rendered && r._rendered.view === 'revaluation/upload');
    check('[2a] isReplace=true in view', r._rendered && r._rendered.vars && r._rendered.vars.isReplace === true);
  } finally { await cleanupFixtures(c2.ids); }
  console.log('\n=== BUG 2b: Re-upload with expired draft ===');
  const c3 = await buildFixtures();
  try {
    let threw = null;
    let r = mkRes();
    const TEN_MIN_AGO = Date.now() - 10 * 60 * 1000;
    try { await ctrl.showUploadPage(mkReq({ params: { resultId: c3.result.result_id }, query: { replace: '1' }, session: { revaluationDraft: { resultId: c3.result.result_id, startedAt: TEN_MIN_AGO, replacing: true } } }), r); } catch (e) { threw = e; }
    check('[3a] expired draft did NOT throw', !threw);
    check('[3a] expired draft rendered upload page', r._rendered && r._rendered.view === 'revaluation/upload');
  } finally { await cleanupFixtures(c3.ids); }
  console.log('\n=== Summary ===');
  console.log('  PASS:', pass, '  FAIL:', fail);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch(err => { console.error('HARNESS CRASH:', err); process.exit(2); });