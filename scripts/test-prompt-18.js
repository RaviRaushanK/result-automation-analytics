'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const crypto = require('crypto');
const path2  = require('path');
const fs2    = require('fs');
const { spawn } = require('child_process');
const db     = require('../database/models');
const { Batch, ResultSession, Student, Result, Subject, SubjectResult,
        ImportLog, OcrExtraction, RevaluationResult, AdminUser, sequelize } = db;
const ctrl  = require('../controllers/revaluationController');

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  PASS:', n); } else { fail++; console.log('  FAIL:', n); } };
function mkRes() {
  const r = { _status: 200, _redirectTo: null };
  r.status = c => { r._status = c; return r; };
  r.redirect = u => { r._redirectTo = u; return r; };
  r.render = () => r; r.json = () => r; return r;
}
function mkReq(o) { o = o || {};
  return { params: o.params||{}, body: o.body||{}, query: o.query||{},
    session: o.session||{}, file: o.file||null,
    app:{get:()=>undefined}, protocol:'http', get:()=>'localhost', headers:{} };
}

async function buildFixtures(stamp) {
  const c = {};
  c.batch = await Batch.create({ batch_uuid: crypto.randomUUID(), department_id: 1,
    batch_name: '__P18__' + stamp, start_year: 2026, end_year: 2027, status: 'active' });
  c.session = await ResultSession.create({ session_uuid: crypto.randomUUID(),
    batch_id: c.batch.batch_id, semester: 'Sem P18', exam_session: 'NOV', exam_year: 2026 });
  c.student = await Student.create({ student_uuid: crypto.randomUUID(), batch_id: c.batch.batch_id,
    usn: 'P18T' + stamp, student_name: 'P18 Tester',
    email: 'p18.' + stamp + '@raas.local', status: 'active' });
  c.subjects = await Promise.all([
    Subject.create({ session_id: c.session.session_id, subject_uuid: crypto.randomUUID(),
      subject_code: 'P18A_' + stamp, subject_name: 'Mathematics',
      subject_type: 'theory', credits: 4, max_internal: 50, max_external: 100, max_marks: 150 }),
    Subject.create({ session_id: c.session.session_id, subject_uuid: crypto.randomUUID(),
      subject_code: 'P18B_' + stamp, subject_name: 'Physics',
      subject_type: 'theory', credits: 3, max_internal: 40, max_external: 60, max_marks: 100 }),
  ]);
  c.result = await Result.create({ result_uuid: crypto.randomUUID(),
    student_id: c.student.student_id, session_id: c.session.session_id,
    attempt_no: 1, exam_type: 'REGULAR', sgpa: 7.0, cgpa: 7.0,
    result_status: 'pass', failed_subject_count: 0 });
  c.srs = await Promise.all([
    SubjectResult.create({ result_id: c.result.result_id, subject_id: c.subjects[0].subject_id,
      marks: 90, grade: 'A', result_status: 'pass' }),
    SubjectResult.create({ result_id: c.result.result_id, subject_id: c.subjects[1].subject_id,
      marks: 25, grade: 'F', result_status: 'fail' }),
  ]);
  c.adminRow = await AdminUser.create({ admin_uuid: crypto.randomUUID(),
    username: '__p18_admin__' + stamp, email: 'p18admin.' + stamp + '@raas.local',
    password_hash: 'x', role: 'admin', status: 'active' });
  const fp = path2.resolve(__dirname, '../uploads/__raas_p18__.pdf');
  try { fs2.mkdirSync(path2.dirname(fp), { recursive: true }); } catch (_) {}
  fs2.writeFileSync(fp, '%PDF-1.4\nfake\n%%EOF\n');
  c._filePath = fp;
  return c;
}

async function buildImport(c) {
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
  const subj = [
    mkSubj(c.srs[0], c.subjects[0], 30, 55, 85),
    mkSubj(c.srs[1], c.subjects[1], 18,  7, 25),
  ];
  const imp = await ImportLog.create({
    session_id: c.session.session_id, uploaded_by: c.adminRow.admin_id,
    file_name: '__p18__.pdf', file_path: c._filePath, file_type: 'pdf',
    import_type: 'REVALUATION', total_records: c.srs.length,
    imported_records: 0, skipped_records: 0, status: 'pending'
  });
  const ocr = await OcrExtraction.create({
    import_id: imp.import_id, raw_text: 'P18_A: 30+55\nP18_B: 18+7',
    confidence_score: 95.00, validation_status: 'pending',
    extracted_json: {
      result_id: c.result.result_id, student_id: c.student.student_id,
      session_id: c.session.session_id,
      attempt: { attempt_no: 1, exam_type: 'REGULAR' },
      student: { usn: c.student.usn, name: c.student.student_name },
      subjects: subj,
      ocr: { extraction_status: 'extracted', extraction_method: 'test',
        warnings: [], unmatched_ocr_codes: [],
        student_candidates: { name: c.student.student_name, usn: c.student.usn },
        semester_candidate: 5, subjects: subj },
      documents: [{ file_name: '__p18__.pdf', file_url: c._filePath, file_path: c._filePath }]
    }
  });
  return { importLog: imp, ocr };
}

async function doSubmitReview(importId, adminId, srid, internal, external) {
  const body = {};
  body['decision_' + srid] = 'accept';
  body['internal_' + srid] = String(internal);
  body['external_' + srid] = String(external);
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params: { importId }, body, session: { adminId } }), r);
  return r;
}

// ONE request containing ALL decision_<srid> fields — matches the real
// application semantics (Prompt 14/15 suites): a single submitReview call
// freezes the complete multi-subject proposal.
async function doSubmitReviewMulti(importId, adminId, decisions) {
  const body = {};
  for (const d of decisions) {
    body['decision_' + d.srid] = 'accept';
    body['internal_' + d.srid] = String(d.internal);
    body['external_' + d.srid] = String(d.external);
  }
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params: { importId }, body, session: { adminId } }), r);
  return r;
}

async function doApprove(importId, adminId) {
  const r = mkRes();
  await ctrl.approveReview(mkReq({ params: { importId }, session: { adminId } }), r);
  return r;
}

async function makeValidated(importLog, ocr) {
  await ImportLog.update({ status: 'extracted' }, { where: { import_id: importLog.import_id } });
  await OcrExtraction.update({ validation_status: 'validated' }, { where: { extraction_id: ocr.extraction_id } });
}

async function cleanup(c, imp, ocr) {
  try {
    if (c.srs && c.srs.length) {
      await RevaluationResult.destroy({ where: { subject_result_id: c.srs.map(s => s.subject_result_id) } });
    }
    if (imp) await ImportLog.destroy({ where: { import_id: imp.import_id } });
    if (ocr) await OcrExtraction.destroy({ where: { extraction_id: ocr.extraction_id } });
    if (c.result) await SubjectResult.destroy({ where: { result_id: c.result.result_id } });
    if (c.session) await Subject.destroy({ where: { session_id: c.session.session_id } });
    if (c.result) await Result.destroy({ where: { result_id: c.result.result_id } });
    if (c.student) await Student.destroy({ where: { student_id: c.student.student_id } });
    if (c.session) await ResultSession.destroy({ where: { session_id: c.session.session_id } });
    if (c.batch) await Batch.destroy({ where: { batch_id: c.batch.batch_id } });
    if (c.adminRow) await AdminUser.destroy({ where: { admin_id: c.adminRow.admin_id } });
  } catch (_) {}
}

function runChild(name, script) {
  return new Promise((resolve) => {
    console.log('\n[' + name + '] Running: ' + script);
    const child = spawn('node', [script], { cwd: path2.resolve(__dirname, '..') });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      const ok = (code === 0);
      const m = out.match(/(\d+) failed/);
      const fc = m ? parseInt(m[1]) : null;
      check(name + ' exit 0', ok);
      if (out.includes('PROMPT')) check(name + ' output has PROMPT', true);
      if (fc !== null) check(name + ' 0 failed', fc === 0);
      console.log('  ' + name + ': ' + (ok ? 'PASS' : 'FAIL') + ' (code=' + code + ')');
      resolve({ ok, code, out });
    });
    child.on('error', err => {
      console.log('  ' + name + ' error: ' + err.message);
      check(name + ' launched', false);
      resolve({ ok: false, code: -1 });
    });
  });
}


// TEST 1 — Schema
async function test1() {
  console.log('\n[1] Schema: indexes on revaluation_results');
  const idx = await sequelize.query(
    "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS " +
    "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='revaluation_results' " +
    "ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    { type: sequelize.QueryTypes.SELECT }
  );
  const m = {};
  for (const r of idx) { if (!m[r.INDEX_NAME]) m[r.INDEX_NAME] = []; m[r.INDEX_NAME].push(r.COLUMN_NAME); }
  check('unique_reval_event index exists', !!m['unique_reval_event']);
  check('unique_reval_event on (srid,reval_no)',
    m['unique_reval_event'] && m['unique_reval_event'].includes('subject_result_id') &&
    m['unique_reval_event'].includes('revaluation_no'));
  check('unique_reval_event is UNIQUE',
    !!(idx.find(r => r.INDEX_NAME === 'unique_reval_event' && r.NON_UNIQUE === 0)));
  check('idx_revaluation_subject_result exists', !!m['idx_revaluation_subject_result']);
  const eng = await sequelize.query(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='revaluation_results'",
    { type: sequelize.QueryTypes.SELECT }
  );
  check('InnoDB engine', !!(eng[0] && eng[0].ENGINE === 'InnoDB'));
}

// TEST 2 — Sequential approval
async function test2() {
  console.log('\n[2] Sequential approval');
  const stamp = Date.now().toString().slice(-6) + 'A';
  const c = await buildFixtures(stamp);
  const { importLog, ocr } = await buildImport(c);
  await doSubmitReviewMulti(importLog.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(importLog, ocr);
  const r = await doApprove(importLog.import_id, c.adminRow.admin_id);
  check('redirected to outcome', !!(r._redirectTo && /\/revaluation\/outcome\//.test(r._redirectTo)));
  const evs = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  check('2 events created', evs.length === 2);
  check('all is_effective=true', evs.every(e => e.is_effective));
  check('all reval_no=1', evs.every(e => Number(e.revaluation_no) === 1));
  check('all approved', evs.every(e => e.revaluation_status === 'approved'));
  const sr0 = await SubjectResult.findByPk(c.srs[0].subject_result_id);
  const sr1 = await SubjectResult.findByPk(c.srs[1].subject_result_id);
  check('srs[0].marks unchanged', Number(sr0.marks) === 90);
  check('srs[1].marks unchanged', Number(sr1.marks) === 25);
  await cleanup(c, importLog, ocr);
}

// TEST 3 — Sequential double approval
async function test3() {
  console.log('\n[3] Sequential double approval');
  const stamp = Date.now().toString().slice(-6) + 'B';
  const c = await buildFixtures(stamp);
  const { importLog, ocr } = await buildImport(c);
  await doSubmitReviewMulti(importLog.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(importLog, ocr);
  await doApprove(importLog.import_id, c.adminRow.admin_id);
  const n1 = await RevaluationResult.count({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  const r2 = await doApprove(importLog.import_id, c.adminRow.admin_id);
  const n2 = await RevaluationResult.count({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  check('2nd approval redirected to outcome', !!(r2._redirectTo && /\/revaluation\/outcome\//.test(r2._redirectTo)));
  check('no new events after 2nd approval', n2 === n1);
  check('total still 2', n2 === 2);
  const evs2 = await RevaluationResult.findAll({ where: { subject_result_id: c.srs[0].subject_result_id } });
  check('events still is_effective', evs2.every(e => e.is_effective));
  await cleanup(c, importLog, ocr);
}

// TEST 4 — Concurrent same-import
async function test4() {
  console.log('\n[4] Concurrent same-import approval');
  const stamp = Date.now().toString().slice(-6) + 'C';
  const c = await buildFixtures(stamp);
  const { importLog, ocr } = await buildImport(c);
  await doSubmitReviewMulti(importLog.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(importLog, ocr);
  const [r1, r2] = await Promise.all([
    doApprove(importLog.import_id, c.adminRow.admin_id),
    doApprove(importLog.import_id, c.adminRow.admin_id),
  ]);
  const evs = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  check('both approvals returned', !!r1 && !!r2);
  check('one approval redirected to outcome',
    !!((r1._redirectTo && /\/revaluation\/outcome\//.test(r1._redirectTo)) ||
       (r2._redirectTo && /\/revaluation\/outcome\//.test(r2._redirectTo))));
  check('exactly 2 events (one per SR)', evs.length === 2);
  check('all events is_effective=true', evs.every(e => e.is_effective));
  const dupc = await sequelize.query(
    "SELECT COUNT(*) AS cnt FROM revaluation_results " +
    "WHERE subject_result_id=? GROUP BY subject_result_id, revaluation_no HAVING COUNT(*)>1",
    { replacements: [c.srs[0].subject_result_id], type: sequelize.QueryTypes.SELECT }
  );
  check('no duplicate (srid,reval_no)', dupc.length === 0);
  await cleanup(c, importLog, ocr);
}

// TEST 5 — Concurrent different imports, same SubjectResult (both fresh)
async function test5() {
  console.log('\n[5] Concurrent different imports, same SubjectResult');
  const stamp = Date.now().toString().slice(-6) + 'D';
  const c = await buildFixtures(stamp);
  const { importLog: imp1, ocr: ocr1 } = await buildImport(c);
  const { importLog: imp2, ocr: ocr2 } = await buildImport(c);
  await OcrExtraction.update(
    { validation_status: 'validated',
      extracted_json: sequelize.literal(
        "JSON_SET(extracted_json, " +
        "'$.ocr.subjects[0].revised_internal_marks', 40, " +
        "'$.ocr.subjects[0].revised_external_marks', 60, " +
        "'$.ocr.subjects[0].revised_marks', 100)") },
    { where: { extraction_id: ocr2.extraction_id } }
  );
  const dec = [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ];
  await doSubmitReviewMulti(imp1.import_id, c.adminRow.admin_id, dec);
  await makeValidated(imp1, ocr1);
  await doSubmitReviewMulti(imp2.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 40, external: 60 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(imp2, ocr2);
  // Concurrent approvals of two DIFFERENT imports targeting the SAME
  // SubjectResults — row locks must serialize them; no duplicates, no
  // double-effective. (P18 core scenario.)
  const [r1, r2] = await Promise.all([
    doApprove(imp1.import_id, c.adminRow.admin_id),
    doApprove(imp2.import_id, c.adminRow.admin_id),
  ]);
  const evs = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs[0].subject_result_id },
    order: [['revaluation_no', 'ASC']]
  });
  check('both approvals returned', !!r1 && !!r2);
  check('at least one approval succeeded', evs.length >= 1);
  check('at most 2 events for srs[0]', evs.length <= 2);
  const dup = await sequelize.query(
    "SELECT COUNT(*) AS cnt FROM revaluation_results " +
    "WHERE subject_result_id=? GROUP BY subject_result_id, revaluation_no HAVING COUNT(*)>1",
    { replacements: [c.srs[0].subject_result_id], type: sequelize.QueryTypes.SELECT }
  );
  check('no duplicate (srid,reval_no)', dup.length === 0);
  const eff = evs.filter(e => e.is_effective);
  check('at most one effective event', eff.length <= 1);
  if (evs.length === 2) {
    check('reval_no set is {1,2}',
      Number(evs[0].revaluation_no) === 1 && Number(evs[1].revaluation_no) === 2);
    check('exactly one effective', eff.length === 1);
    check('effective is latest (no=2)', Number(eff[0].revaluation_no) === 2);
    const marks = evs.map(e => Number(e.revised_marks)).sort((a, b) => a - b);
    check('revised_marks are {85,100}', marks[0] === 85 && marks[1] === 100);
  }
  await cleanup(c, imp1, ocr1);
  await cleanup(c, imp2, ocr2);
}

// TEST 6 — Sequential follow-up round: same SubjectResult (reval_no 1 -> 2)
async function test6() {
  console.log('\n[6] Sequential follow-up round (reval_no 1 -> 2, demote/promote)');
  const stamp = Date.now().toString().slice(-6) + 'D';
  const c = await buildFixtures(stamp);
  const { importLog: imp1, ocr: ocr1 } = await buildImport(c);
  await doSubmitReviewMulti(imp1.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(imp1, ocr1);
  await doApprove(imp1.import_id, c.adminRow.admin_id);
  const { importLog: imp2, ocr: ocr2 } = await buildImport(c);
  await OcrExtraction.update(
    { validation_status: 'validated',
      extracted_json: sequelize.literal(
        "JSON_SET(extracted_json, " +
        "'$.ocr.subjects[0].revised_internal_marks', 40, " +
        "'$.ocr.subjects[0].revised_external_marks', 60, " +
        "'$.ocr.subjects[0].revised_marks', 100)") },
    { where: { extraction_id: ocr2.extraction_id } }
  );
  await makeValidated(imp2, ocr2);
  await doSubmitReviewMulti(imp2.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 40, external: 60 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await OcrExtraction.update({ validation_status: 'validated' },
    { where: { extraction_id: ocr2.extraction_id } });
  const [r1, r2] = await Promise.all([
    doApprove(imp1.import_id, c.adminRow.admin_id),
    doApprove(imp2.import_id, c.adminRow.admin_id),
  ]);
  const evs = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs[0].subject_result_id },
    order: [['revaluation_no', 'ASC']]
  });
  check('2 events for srs[0] (one per import)', evs.length === 2);
  check('ev[0] reval_no=1', Number(evs[0].revaluation_no) === 1);
  check('ev[1] reval_no=2', Number(evs[1].revaluation_no) === 2);
  check('ev[0] is_effective=false (demoted)', !evs[0].is_effective);
  check('ev[1] is_effective=true (latest)', evs[1].is_effective);
  check('ev[0] revised_marks=85 (30+55)', Number(evs[0].revised_marks) === 85);
  check('ev[1] revised_marks=100 (40+60)', Number(evs[1].revised_marks) === 100);
  const dup = await sequelize.query(
    "SELECT COUNT(*) AS cnt FROM revaluation_results " +
    "WHERE subject_result_id=? GROUP BY subject_result_id, revaluation_no HAVING COUNT(*)>1",
    { replacements: [c.srs[0].subject_result_id], type: sequelize.QueryTypes.SELECT }
  );
  check('no duplicate (srid,reval_no)', dup.length === 0);
  await cleanup(c, imp1, ocr1);
  await cleanup(c, imp2, ocr2);
}

// TEST 7 — Stale baseline rejection
async function test7() {
  console.log('\n[7] Stale baseline rejection');
  const stamp = Date.now().toString().slice(-6) + 'F';
  const c = await buildFixtures(stamp);
  const { importLog, ocr } = await buildImport(c);
  await doSubmitReviewMulti(importLog.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(importLog, ocr);
  await SubjectResult.update({ marks: 999 },
    { where: { subject_result_id: c.srs[0].subject_result_id } });
  const r = await doApprove(importLog.import_id, c.adminRow.admin_id);
  check('rejected (not /outcome/)', !r._redirectTo || !r._redirectTo.includes('/outcome/'));
  const evs = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs[0].subject_result_id }
  });
  check('no event for tampered subject', evs.length === 0);
  const evs1 = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs[1].subject_result_id }
  });
  check('untampered subject NOT partially approved', evs1.length === 0);
  await SubjectResult.update({ marks: 90 },
    { where: { subject_result_id: c.srs[0].subject_result_id } });
  await cleanup(c, importLog, ocr);
}

// TEST 8 — Rollback integrity
async function test8() {
  console.log('\n[8] Rollback integrity');
  const stamp = Date.now().toString().slice(-6) + 'G';
  const c = await buildFixtures(stamp);
  const { importLog, ocr } = await buildImport(c);
  await doSubmitReviewMulti(importLog.import_id, c.adminRow.admin_id, [
    { srid: c.srs[0].subject_result_id, internal: 30, external: 55 },
    { srid: c.srs[1].subject_result_id, internal: 18, external: 7 },
  ]);
  await makeValidated(importLog, ocr);
  const n0 = await RevaluationResult.count({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  await SubjectResult.update({ marks: 999 },
    { where: { subject_result_id: c.srs[0].subject_result_id } });
  await doApprove(importLog.import_id, c.adminRow.admin_id);
  const n1 = await RevaluationResult.count({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  const log = await ImportLog.findByPk(importLog.import_id);
  check('no new rows after failed approval', n1 === n0);
  check('ImportLog not marked success', log.status !== 'success');
  await SubjectResult.update({ marks: 90 },
    { where: { subject_result_id: c.srs[0].subject_result_id } });
  await cleanup(c, importLog, ocr);
}

// ================================================================
// Entry
// ================================================================
(async () => {
  console.log('==== PROMPT 18: TX-B Concurrency & Integrity ====');
  try { await test1(); } catch(e) { console.error('[1] ERROR:', e.message); }
  try { await test2(); } catch(e) { console.error('[2] ERROR:', e.message); }
  try { await test3(); } catch(e) { console.error('[3] ERROR:', e.message); }
  try { await test4(); } catch(e) { console.error('[4] ERROR:', e.message); }
  try { await test5(); } catch(e) { console.error('[5] ERROR:', e.message); }
  try { await test6(); } catch(e) { console.error('[6] ERROR:', e.message); }
  try { await test7(); } catch(e) { console.error('[7] ERROR:', e.message); }
  try { await test8(); } catch(e) { console.error('[8] ERROR:', e.message); }

  console.log('\n[9] Prompt 14 regression');
  await runChild('P14', 'scripts/test-prompt-14.js');
  console.log('\n[10] Prompt 15 regression');
  await runChild('P15', 'scripts/test-prompt-15.js');
  console.log('\n[11] Prompt 16 regression');
  await runChild('P16', 'scripts/test-prompt-16.js');

  console.log('\n==== PROMPT 18: ' + pass + ' passed, ' + fail + ' failed ====');
  try { await sequelize.close(); } catch (_) {}
  process.exit(fail === 0 ? 0 : 1);
})();
