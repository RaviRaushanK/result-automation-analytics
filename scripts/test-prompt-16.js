'use strict';
/**
 * scripts/test-prompt-16.js — PROMPT 16 acceptance harness.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const crypto = require('crypto');
const path   = require('path');
const fs2    = require('fs');
const { spawn } = require('child_process');
const db     = require('../database/models');
const { Batch, ResultSession, Student, Result, Subject, SubjectResult,
        ImportLog, OcrExtraction, RevaluationResult, AdminUser } = db;
const ctrl  = require('../controllers/revaluationController');

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
  return { params: o.params||{}, body: o.body||{}, query: o.query||{},
    session: o.session||{}, file: o.file||null,
    app:{get:()=>undefined}, protocol:'http',
    get:()=>'localhost', headers:{} };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function withStubExtractor(stubOutcome, fn) {
  const ctrlPath = path.resolve(__dirname, '../controllers/revaluationController.js');
  const svcPath  = path.resolve(__dirname, '../services/revaluationExtractor.js');
  const orig = require.cache[svcPath];
  require.cache[svcPath] = { id: svcPath, loaded: true,
    exports: { extractAndBuild: () => Promise.resolve(stubOutcome) } };
  try { delete require.cache[ctrlPath]; await fn(require(ctrlPath)); }
  finally { if (orig) require.cache[svcPath] = orig; else delete require.cache[svcPath]; delete require.cache[ctrlPath]; }
}


async function buildFixtures() {
  const c = {}; const stamp = Date.now().toString().slice(-6);
  c.batch = await Batch.create({ batch_uuid: crypto.randomUUID(), department_id: 1,
    batch_name: '__RAAS_P16__', start_year: 2026, end_year: 2027, status: 'active' });
  c.session = await ResultSession.create({ session_uuid: crypto.randomUUID(),
    batch_id: c.batch.batch_id, semester: 'Sem P16', exam_session: 'NOV', exam_year: 2026 });
  c.student = await Student.create({ student_uuid: crypto.randomUUID(), batch_id: c.batch.batch_id,
    usn: 'P16T' + stamp, student_name: 'Prompt 16 Tester',
    email: 'p16.' + stamp + '@raas.local', status: 'active' });
  c.subjects = await Promise.all([
    Subject.create({ session_id: c.session.session_id, subject_uuid: crypto.randomUUID(),
      subject_code: 'P16A_' + stamp, subject_name: 'Mathematics',
      subject_type: 'theory', credits: 4, max_internal: 50, max_external: 100, max_marks: 150 }),
    Subject.create({ session_id: c.session.session_id, subject_uuid: crypto.randomUUID(),
      subject_code: 'P16B_' + stamp, subject_name: 'Physics',
      subject_type: 'theory', credits: 3, max_internal: 40, max_external: 60, max_marks: 100 })
  ]);
  c.result = await Result.create({ result_uuid: crypto.randomUUID(),
    student_id: c.student.student_id, session_id: c.session.session_id,
    attempt_no: 1, exam_type: 'REGULAR', sgpa: 7.0, cgpa: 7.0,
    result_status: 'pass', failed_subject_count: 0 });
  c.srs = await Promise.all([
    SubjectResult.create({ result_id: c.result.result_id, subject_id: c.subjects[0].subject_id,
      marks: 90, grade: 'A', result_status: 'pass' }),
    SubjectResult.create({ result_id: c.result.result_id, subject_id: c.subjects[1].subject_id,
      marks: 25, grade: 'F', result_status: 'fail' })
  ]);
  c.adminRow = await AdminUser.create({ admin_uuid: crypto.randomUUID(),
    username: '__raas_p16_admin__' + stamp, email: 'p16admin.' + stamp + '@raas.local',
    password_hash: 'x', role: 'admin', status: 'active' });
  const fp = path.resolve(__dirname, '../uploads/__raas_p16__.pdf');
  try { fs2.mkdirSync(path.dirname(fp), { recursive: true }); } catch (_) {}
  fs2.writeFileSync(fp, '%PDF-1.4\nfake\n%%EOF\n');
  c._filePath = fp;
  c._newEvents = [];
  return c;
}

/** [1] createImport — pending status, OcrExtraction with valid context. */
async function step1_createImport(c) {
  console.log('\n[1] createImport (pending)');
  c.importLog = await ImportLog.create({ session_id: c.session.session_id,
    uploaded_by: c.adminRow.admin_id, file_name: '__raas_p16__.pdf',
    file_path: c._filePath, file_type: 'pdf', import_type: 'REVALUATION',
    total_records: c.srs.length, imported_records: 0, skipped_records: 0,
    status: 'pending' });
  const nc = s => s.replace(/[^A-Z0-9]/gi, '');
  const mkSubj = (sr, s, i, e, tot) => ({
    subject_result_id: sr.subject_result_id, subject_id: s.subject_id,
    subject_code: s.subject_code, subject_name: s.subject_name,
    original_marks: sr.marks, original_status: sr.result_status,
    ocr_subject_code: s.subject_code, normalized_code: nc(s.subject_code),
    match_state: 'MATCHED',
    revised_internal_marks: i, revised_external_marks: e, revised_marks: tot,
    revised_status_candidate: 'pass', raw_status: null, confidence: 0.95, raw_line: 'OCR'
  });
  const subj = [mkSubj(c.srs[0], c.subjects[0], 30, 55, 85), mkSubj(c.srs[1], c.subjects[1], 18, 7, 25)];
  c.ocr = await OcrExtraction.create({ import_id: c.importLog.import_id,
    raw_text: 'P16_A: 30+55\nP16_B: 18+7', confidence_score: 95.00, validation_status: 'pending',
    extracted_json: {
      result_id: c.result.result_id, student_id: c.student.student_id,
      session_id: c.session.session_id,
      attempt: { attempt_no: 1, exam_type: 'REGULAR' },
      student: { usn: c.student.usn, name: c.student.student_name },
      subjects: subj,
      ocr: { extraction_status: 'extracted', extraction_method: 'test',
        warnings: [], unmatched_ocr_codes: [],
        student_candidates: { name: c.student.student_name, usn: c.student.usn },
        semester_candidate: 5, subjects: subj,
        rows: [
          { subject_result_id: c.srs[0].subject_result_id, revised_internal: 30, revised_external: 55, source: 'ocr' },
          { subject_result_id: c.srs[1].subject_result_id, revised_internal: 18, revised_external:  7, source: 'ocr' }
        ] },
      documents: [{ file_name: '__raas_p16__.pdf', file_url: c._filePath, file_path: c._filePath }]
    } });
  check('ImportLog created', c.importLog.status === 'pending');
  check('OcrExtraction created', !!c.ocr);
  check('OcrExtraction.validation_status pending', c.ocr.validation_status === 'pending');
}

/** [2] submitReview creates validated review. */
async function step2_createReview(c) {
  console.log('\n[2] Create validated review');
  await withStubExtractor({ ok: true, ocr: {
    extraction_status: 'extracted', extraction_method: 'test',
    warnings: [], unmatched_ocr_codes: [],
    student_candidates: { name: c.student.student_name, usn: c.student.usn },
    semester_candidate: 5,
    subjects: [
      { subject_result_id: c.srs[0].subject_result_id, subject_id: c.subjects[0].subject_id,
        subject_code: c.subjects[0].subject_code, subject_name: c.subjects[0].subject_name,
        original_marks: c.srs[0].marks, original_status: 'pass',
        ocr_subject_code: c.subjects[0].subject_code,
        normalized_code: c.subjects[0].subject_code.replace(/[^A-Z0-9]/gi, ''),
        match_state: 'MATCHED',
        revised_internal_marks: 30, revised_external_marks: 55,
        revised_marks: 85, revised_status_candidate: 'pass',
        raw_status: null, confidence: 0.95, raw_line: 'OCR line 0' },
      { subject_result_id: c.srs[1].subject_result_id, subject_id: c.subjects[1].subject_id,
        subject_code: c.subjects[1].subject_code, subject_name: c.subjects[1].subject_name,
        original_marks: c.srs[1].marks, original_status: 'fail',
        ocr_subject_code: c.subjects[1].subject_code,
        normalized_code: c.subjects[1].subject_code.replace(/[^A-Z0-9]/gi, ''),
        match_state: 'MATCHED',
        revised_internal_marks: 18, revised_external_marks: 7,
        revised_marks: 25, revised_status_candidate: 'pass',
        raw_status: null, confidence: 0.95, raw_line: 'OCR line 1' }
    ],
    rows: [
      { subject_result_id: c.srs[0].subject_result_id, revised_internal: 30, revised_external: 55, source: 'ocr' },
      { subject_result_id: c.srs[1].subject_result_id, revised_internal: 18, revised_external:  7, source: 'ocr' }
    ]
  }, raw_text: 'P16A: 30+55\nP16B: 18+7', confidenceScore: 0.95 }, async (fc) => {
    await fc.runExtraction(mkReq({ params: { importId: c.importLog.import_id } }), mkRes());
  });
  const body = {};
  body['decision_' + c.srs[0].subject_result_id] = 'accept';
  body['internal_' + c.srs[0].subject_result_id] = '30';
  body['external_' + c.srs[0].subject_result_id] = '55';
  body['decision_' + c.srs[1].subject_result_id] = 'accept';
  body['internal_' + c.srs[1].subject_result_id] = '18';
  body['external_' + c.srs[1].subject_result_id] = '7';
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params: { importId: c.importLog.import_id },
    body, session: { adminId: c.adminRow.admin_id } }), r);
  check('submitReview redirected', r._redirectTo && r._redirectTo.includes('/review/'));
  const after = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const saved = after.extracted_json || {};
  check('review proposal saved', !!(saved.review && saved.review.proposal));
  check('validation_status === validated', after.validation_status === 'validated');
  check('proposal has 2 rows', (saved.review && saved.review.proposal.length) === 2);
}

/** [3] runExtraction (successful) — verifies R2 (delete nextJson.review). */
async function step3_runExtraction_success(c) {
  console.log('\n[3] Successful re-extraction invalidates review (R2)');
  await ImportLog.update({ status: 'pending' }, { where: { import_id: c.importLog.import_id } });
  await OcrExtraction.update({ validation_status: 'pending' }, { where: { extraction_id: c.ocr.extraction_id } });
  await withStubExtractor({ ok: true, ocr: {
    extraction_status: 'extracted', extraction_method: 'test',
    warnings: [], unmatched_ocr_codes: [],
    student_candidates: { name: c.student.student_name, usn: c.student.usn },
    semester_candidate: 5,
    subjects: [
      { subject_result_id: c.srs[0].subject_result_id, subject_id: c.subjects[0].subject_id,
        subject_code: c.subjects[0].subject_code, subject_name: c.subjects[0].subject_name,
        original_marks: c.srs[0].marks, original_status: 'pass',
        ocr_subject_code: c.subjects[0].subject_code,
        normalized_code: c.subjects[0].subject_code.replace(/[^A-Z0-9]/gi, ''),
        match_state: 'MATCHED',
        revised_internal_marks: 32, revised_external_marks: 58,
        revised_marks: 90, revised_status_candidate: 'pass',
        raw_status: null, confidence: 0.92, raw_line: 'OCR NEW' },
      { subject_result_id: c.srs[1].subject_result_id, subject_id: c.subjects[1].subject_id,
        subject_code: c.subjects[1].subject_code, subject_name: c.subjects[1].subject_name,
        original_marks: c.srs[1].marks, original_status: 'fail',
        ocr_subject_code: c.subjects[1].subject_code,
        normalized_code: c.subjects[1].subject_code.replace(/[^A-Z0-9]/gi, ''),
        match_state: 'MATCHED',
        revised_internal_marks: 20, revised_external_marks: 9,
        revised_marks: 29, revised_status_candidate: 'pass',
        raw_status: null, confidence: 0.92, raw_line: 'OCR NEW' }
    ],
    rows: [
      { subject_result_id: c.srs[0].subject_result_id, revised_internal: 32, revised_external: 58, source: 'ocr' },
      { subject_result_id: c.srs[1].subject_result_id, revised_internal: 20, revised_external:  9, source: 'ocr' }
    ]
  }, raw_text: 'P16A: 32+58\nP16B: 20+9', confidenceScore: 0.92 }, async (fc) => {
    const r = mkRes();
    await fc.runExtraction(mkReq({ params: { importId: c.importLog.import_id } }), r);
    check('runExtraction redirected to /extraction/', r._redirectTo && r._redirectTo.includes('/extraction/'));
    const after = await OcrExtraction.findByPk(c.ocr.extraction_id);
    const saved = after.extracted_json || {};
    check('review cleared after successful re-extraction', !saved.review);
    check('validation_status reset to pending', after.validation_status === 'pending');
    check('new OCR subject[0].revised_internal_marks === 32',
      saved.ocr && saved.ocr.subjects && saved.ocr.subjects[0] && saved.ocr.subjects[0].revised_internal_marks === 32);
    check('new OCR subject[1].revised_external_marks === 9',
      saved.ocr && saved.ocr.subjects && saved.ocr.subjects[1] && saved.ocr.subjects[1].revised_external_marks === 9);
    check('result_id preserved', saved.result_id === c.result.result_id);
    check('student_id preserved', saved.student_id === c.student.student_id);
    check('ImportLog.status === extracted',
      (await ImportLog.findByPk(c.importLog.import_id)).status === 'extracted');
  });
}

/** [4] Approval blocked after re-extraction (no fresh review submitted). */
async function step4_approvalBlocked(c) {
  console.log('\n[4] Approval blocked after re-extraction (R2)');
  const countBefore = await RevaluationResult.count({ where: {
    subject_result_id: { [db.sequelize.Sequelize.Op.in]: c.srs.map(s => s.subject_result_id) } } });
  const r = mkRes(); let threw = false;
  try {
    await ctrl.approveReview(mkReq({ params: { importId: c.importLog.import_id },
      session: { adminId: c.adminRow.admin_id } }), r);
  } catch (e) { threw = true;
    check('approveReview threw on missing review', e.message && e.message.toLowerCase().includes('missing')); }
  if (!threw) check('approval did not reach /outcome/', !r._redirectTo || !r._redirectTo.includes('/outcome/'));
  const countAfter = await RevaluationResult.count({ where: {
    subject_result_id: { [db.sequelize.Sequelize.Op.in]: c.srs.map(s => s.subject_result_id) } } });
  check('no new RevaluationResult rows', countAfter === countBefore);
}

/** [5] Fresh review + approval succeeds (normal flow). */
async function step5_freshReviewAndApprove(c) {
  console.log('\n[5] Fresh review + approval succeeds (normal flow)');
  const body = {};
  body['decision_' + c.srs[0].subject_result_id] = 'accept';
  body['internal_' + c.srs[0].subject_result_id] = '32';
  body['external_' + c.srs[0].subject_result_id] = '58';
  body['decision_' + c.srs[1].subject_result_id] = 'accept';
  body['internal_' + c.srs[1].subject_result_id] = '20';
  body['external_' + c.srs[1].subject_result_id] = '9';
  const r1 = mkRes();
  await ctrl.submitReview(mkReq({ params: { importId: c.importLog.import_id },
    body, session: { adminId: c.adminRow.admin_id } }), r1);
  check('submitReview succeeded', r1._redirectTo && r1._redirectTo.includes('/review/'));
  const r2 = mkRes();
  await ctrl.approveReview(mkReq({ params: { importId: c.importLog.import_id },
    session: { adminId: c.adminRow.admin_id } }), r2);
  check('approveReview reached /outcome/', r2._redirectTo && r2._redirectTo.includes('/outcome/'));
  const evts = await RevaluationResult.findAll({ where: {
    subject_result_id: { [db.sequelize.Sequelize.Op.in]: c.srs.map(s => s.subject_result_id) },
    reviewed_by: c.adminRow.admin_id } });
  check('one event per accepted target', evts.length === 2);
  for (const ev of evts) {
    check('event is_effective === true', ev.is_effective === true);
    check('event revaluation_no === 1', ev.revaluation_no === 1);
  }
  const sr0 = await SubjectResult.findByPk(c.srs[0].subject_result_id);
  const sr1 = await SubjectResult.findByPk(c.srs[1].subject_result_id);
  check('SubjectResult[0].marks unchanged at 90', sr0.marks === 90);
  check('SubjectResult[1].marks unchanged at 25', sr1.marks === 25);
  check('ImportLog.status === success',
    (await ImportLog.findByPk(c.importLog.import_id)).status === 'success');
  c._newEvents = evts;
}

/** [6] runExtraction idempotent after success — outer idempotency check blocks. */
async function step6_idempotentAfterSuccess(c) {
  console.log('\n[6] runExtraction idempotent after success');
  const before = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const logBefore = await ImportLog.findByPk(c.importLog.import_id);
  const beforeOcr = JSON.stringify(before.extracted_json.ocr);
  const r = mkRes(); let threw = false;
  try { await ctrl.runExtraction(mkReq({ params: { importId: c.importLog.import_id } }), r); }
  catch (e) { threw = true; }
  check('second runExtraction did not throw', !threw);
  check('second runExtraction redirected', !!r._redirectTo);
  check('redirected to /extraction/', r._redirectTo && r._redirectTo.includes('/extraction/'));
  const after = await OcrExtraction.findByPk(c.ocr.extraction_id);
  check('OcrExtraction rows unchanged', JSON.stringify(after.extracted_json.ocr) === beforeOcr);
  check('validation_status unchanged', after.validation_status === before.validation_status);
  check('ImportLog.status unchanged', (await ImportLog.findByPk(c.importLog.import_id)).status === logBefore.status);
}

/** [7] PROMPT-14 regression (child-process spawn). */
async function step7_p14() {
  console.log('\n[7] PROMPT-14 regression (child-process spawn)');
  const child = spawn('node', [path.resolve(__dirname, 'test-prompt-14.js')], { stdio: ['ignore','pipe','pipe'] });
  let stdout = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stdout += d; });
  const code = await new Promise(res => child.on('close', c => setTimeout(() => res(c), 400)));
  await sleep(600);
  check('P14 child process exited 0', code === 0);
  check('P14 output contains PROMPT 14', stdout.includes('PROMPT 14'));
  check('P14 reports 0 failed', stdout.includes('0 failed'));
}

/** [8] PROMPT-15 regression (child-process spawn). */
async function step8_p15() {
  console.log('\n[8] PROMPT-15 regression (child-process spawn)');
  const child = spawn('node', [path.resolve(__dirname, 'test-prompt-15.js')], { stdio: ['ignore','pipe','pipe'] });
  let stdout = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stdout += d; });
  const code = await new Promise(res => child.on('close', c => setTimeout(() => res(c), 400)));
  await sleep(600);
  check('P15 child process exited 0', code === 0);
  check('P15 output contains PROMPT 15', stdout.includes('PROMPT 15'));
  check('P15 reports 0 failed', stdout.includes('0 failed'));
}

async function cleanup(c) {
  if (!c) return;
  try { for (const ev of (c._newEvents || [])) {
    try { await RevaluationResult.destroy({ where: { revaluation_id: ev.revaluation_id } }); }
    catch (_) {} } } catch (_) {}
  try { await OcrExtraction.destroy({ where: { extraction_id: c.ocr.extraction_id } }); } catch (_) {}
  try { await ImportLog.destroy({ where: { import_id: c.importLog.import_id } }); } catch (_) {}
  for (const sr of c.srs) { try { await SubjectResult.destroy({ where: { subject_result_id: sr.subject_result_id } }); } catch (_) {} }
  for (const s of c.subjects) { try { await Subject.destroy({ where: { subject_id: s.subject_id } }); } catch (_) {} }
  try { await Student.destroy({ where: { student_id: c.student.student_id } }); } catch (_) {}
  try { await Result.destroy({ where: { result_id: c.result.result_id } }); } catch (_) {}
  try { await ResultSession.destroy({ where: { session_id: c.session.session_id } }); } catch (_) {}
  try { await Batch.destroy({ where: { batch_id: c.batch.batch_id } }); } catch (_) {}
  try { await AdminUser.destroy({ where: { admin_id: c.adminRow.admin_id } }); } catch (_) {}
  console.log('Cleanup complete.');
}

(async () => {
  let created;
  try {
    created = await buildFixtures();
    await step1_createImport(created);
    await step2_createReview(created);
    await step3_runExtraction_success(created);
    await step4_approvalBlocked(created);
    await step5_freshReviewAndApprove(created);
    await step6_idempotentAfterSuccess(created);
    await step7_p14();
    await step8_p15();
    console.log('\n==== PROMPT 16: ' + pass + ' passed, ' + fail + ' failed ====');
  } catch (err) {
    console.error('FATAL:', err.message); console.error(err.stack); fail++;
    console.log('\n==== PROMPT 16: ' + pass + ' passed, ' + fail + ' failed ====');
  } finally { await cleanup(created); }
  process.exit(fail > 0 ? 1 : 0);
})();
