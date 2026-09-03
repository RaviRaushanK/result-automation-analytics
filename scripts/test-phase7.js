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
const V = require('../services/revaluationValidator');
const P = require('../services/revaluationPersistence');

let pass = 0, fail = 0;
function record(ok) { ok ? pass++ : fail++; }
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

// ===== A. Regression Child Suites =====
// ===== B. Security: Unit Tests =====
function runSecurityUnitTests() {
  console.log('\n[Security: Unit Tests]');
  let _p = pass, _f = fail;
  const _chk = (result, label, exp) => {
    const ok = result === exp;
    console.log((ok ? '  PASS' : '  FAIL') + '  ' + label + (ok ? '' : ' | exp: ' + JSON.stringify(exp) + ' got: ' + JSON.stringify(result)));
    ok ? _p++ : _f++;
  };
  _chk(V.validateCardResult('Test','XYZ').ok, 'B1 invalid result rejected', false);
  _chk(V.validateCardResult('Test','pass').ok, 'B2 valid result accepted', true);
  _chk(V.validateCardMarks('Test', -5, 100).ok, 'B3 negative marks rejected', false);
  _chk(V.validateCardMarks('Test', 150, 100).ok, 'B4 over-max marks rejected', false);
  _chk(V.validateCardMarks('Test', 100, 100).ok, 'B5 boundary max marks accepted', true);
  _chk(V.validateCardMarks('Test', '75', 100).ok, 'B6 string number accepted', true);
  _chk(V.validateCardMarks('Test', 'abc', 100).ok, 'B7 NaN rejected', false);
  pass = _p; fail = _f;
}

// ===== D. Audit Trail: Unit =====
function runAuditTrailTests() {
  console.log('\n[Audit Trail: Unit]');
  let _p = pass, _f = fail;
  const _chk = (got, label, exp) => {
    const ok = JSON.stringify(got) === JSON.stringify(exp);
    console.log((ok ? '  PASS' : '  FAIL') + '  ' + label + (ok ? '' : ' | exp: ' + JSON.stringify(exp) + ' got: ' + JSON.stringify(got)));
    ok ? _p++ : _f++;
  };
  const p1 = JSON.parse(P.buildEventRemarksEx(90010,'pdfjs',{source:'MISSING_MANUAL',decision:'accept',was_manual_correction:true,event_ids:[]}));
  p1.event_ids = [1001,1002,1003];
  _chk(p1.event_ids.length, 'D1 event_ids length=3', 3);
  _chk(p1.event_ids.every(n => Number.isInteger(n)), 'D1 all integers', true);
  _chk(p1.event_ids.indexOf(1001)!==-1 && p1.event_ids.indexOf(1003)!==-1, 'D1 contains first+last', true);
  for (const src of ['MISSING_MANUAL','OCR_DETECTED','UNMATCHED_ATTACH']) {
    const r2 = JSON.parse(P.buildEventRemarksEx(90011,'stub',{source:src,decision:'accept',was_manual_correction:src==='MISSING_MANUAL',event_ids:[]}));
    _chk(r2.source, 'D2 source "' + src + '"', src);
  }
  const p3 = JSON.parse(P.buildEventRemarksEx(90012,'tesseract',{source:'OCR_DETECTED',decision:'accept',was_manual_correction:false,event_ids:[]}));
  _chk(p3.base_remarks.indexOf('90012')!==-1, 'D3 base_remarks has import #', true);
  _chk(p3.base_remarks.indexOf('tesseract')!==-1, 'D3 base_remarks has OCR method', true);
  _chk(p3.base_remarks.indexOf('approved')!==-1, 'D3 base_remarks has approved', true);
  _chk(p3.base_remarks.indexOf('T')!==-1, 'D3 base_remarks has ISO date', true);
  const parsed = JSON.parse(P.buildEventRemarksEx(90013,'pdfjs',{source:'MISSING_MANUAL',decision:'accept',was_manual_correction:true,event_ids:[501,502]}));
  _chk(parsed.source, 'D4 round-trip source', 'MISSING_MANUAL');
  _chk(parsed.decision, 'D4 round-trip decision', 'accept');
  _chk(parsed.was_manual_correction, 'D4 round-trip was_manual', true);
  _chk(parsed.event_ids[0], 'D4 round-trip event_ids[0]', 501);
  _chk(parsed.event_ids[1], 'D4 round-trip event_ids[1]', 502);
  pass = _p; fail = _f;
}



// ===== C. Security: Integration (DB) =====
async function runSecurityIntegration() {
  console.log('\n[Security: Integration (DB) — forged srid]');
  let c1 = null;
  try {
    const stamp1 = Date.now().toString().slice(-6) + 'c1';
    c1 = await buildFixtures(stamp1);
    const { importLog, ocr } = await buildImport(c1);
    c1.importLog = importLog; c1.ocr = ocr;
    await ImportLog.update({ status: 'extracted' }, { where: { import_id: importLog.import_id } });
    await OcrExtraction.update({ validation_status: 'validated' }, { where: { extraction_id: ocr.extraction_id } });
    const forgedId = 999999;
    const srid1 = c1.srs[0].subject_result_id;
    const srid2 = c1.srs[1].subject_result_id;
    const body = {};
    body['decision_' + forgedId] = 'accept';
    body['internal_' + forgedId] = '30';
    body['external_' + forgedId] = '55';
    body['decision_' + srid1] = 'accept';
    body['internal_' + srid1] = '30';
    body['external_' + srid1] = '55';
    body['decision_' + srid2] = 'accept';
    body['internal_' + srid2] = '18';
    body['external_' + srid2] = '7';
    const res = mkRes();
    await ctrl.submitReview(mkReq({ params: { importId: importLog.import_id }, body, session: { adminId: c1.adminRow.admin_id } }), res);
    const afterSubmit = await OcrExtraction.findByPk(ocr.extraction_id);
    const saved = JSON.parse(JSON.stringify(afterSubmit.extracted_json));
    const proposal = (saved.review && saved.review.proposal) || [];
    const forgedInProposal = proposal.some(p => Number(p.subject_result_id) === forgedId);
    record(!forgedInProposal, 'C1 forged srid not in proposal', true, true);
  } catch (e) {
    console.error('  EXCEPTION:', e.message);
    if (e && e.stack) console.error('     ' + e.stack.split('\n').slice(0,2).join('\n     '));
    fail++;
  } finally {
    if (c1) await cleanup(c1, c1.importLog, c1.ocr);
  }
}

// ===== C2 duplicate addMissing =====
async function runSecurityIntegration_C2() {
  console.log('\n[Security: Integration (DB) — duplicate addMissing]');
  let c2 = null;
  try {
    const stamp2 = Date.now().toString().slice(-6) + 'c2';
    c2 = await buildFixtures(stamp2);
    const { importLog: imp2, ocr: ocr2 } = await buildImport(c2);
    c2.importLog = imp2; c2.ocr = ocr2;
    await ImportLog.update({ status: 'extracted' }, { where: { import_id: imp2.import_id } });
    await OcrExtraction.update({ validation_status: 'validated' }, { where: { extraction_id: ocr2.extraction_id } });
    const req1 = mkReq({ params: { importId: imp2.import_id },
      body: { subject_result_id: String(c2.srs[0].subject_result_id),
              card_internal_marks: '25', card_old_marks: '45', card_old_result: 'pass',
              card_rv_marks: '50', card_rv_result: 'pass', card_final_marks: '75', card_final_result: 'pass' } });
    const r1 = mkRes();
    await ctrl.addMissing(req1, r1);
    record(r1._status < 300, 'C2 first addMissing → status < 300', true, true);
    const after1 = await OcrExtraction.findByPk(ocr2.extraction_id);
    const saved1 = JSON.parse(JSON.stringify(after1.extracted_json));
    const proposals1 = saved1.review && saved1.review.proposal || [];
    const count1 = proposals1.filter(p => Number(p.subject_result_id) === Number(c2.srs[0].subject_result_id)).length;
    record(count1 <= 1, 'C2 first call → at most 1 row', true, true);
    const req2 = mkReq({ params: { importId: imp2.import_id },
      body: { subject_result_id: String(c2.srs[0].subject_result_id), card_final_marks: '75', card_final_result: 'pass' } });
    const r2 = mkRes();
    await ctrl.addMissing(req2, r2);
    const threw2 = r2._status >= 300;
    const after2 = await OcrExtraction.findByPk(ocr2.extraction_id);
    const saved2 = JSON.parse(JSON.stringify(after2.extracted_json));
    const proposals2 = saved2.review && saved2.review.proposal || [];
    const count2 = proposals2.filter(p => Number(p.subject_result_id) === Number(c2.srs[0].subject_result_id)).length;
    record(threw2 || (r2._redirectTo && r2._redirectTo.indexOf('already') !== -1), 'C2 duplicate → error or already exists', true, true);
    record(count2 === 1, 'C2 final count exactly 1', true, true);
  } catch (e) {
    console.error('  EXCEPTION:', e.message);
    if (e && e.stack) console.error('     ' + e.stack.split('\n').slice(0,2).join('\n     '));
    fail++;
  } finally {
    if (c2) await cleanup(c2, c2.importLog, c2.ocr);
  }
}

// ===== E. Original Result: Protection =====
async function runOriginalResultTests() {
  console.log('\n[Original Result: Protection]');
  const stamp = Date.now().toString().slice(-6) + 'e';
  let c = null;
  try {
    c = await buildFixtures(stamp);
    const { importLog, ocr } = await buildImport(c);
    c.importLog = importLog; c.ocr = ocr;
    const srBefore = await SubjectResult.findByPk(c.srs[0].subject_result_id);
    record(Number(srBefore.marks) === 90, 'E1 marks before extraction', true, true);
    record(srBefore.result_status === 'pass', 'E1 status before extraction', true, true);
    await ImportLog.update({ status: 'extracted' }, { where: { import_id: importLog.import_id } });
    await OcrExtraction.update({ validation_status: 'validated' }, { where: { extraction_id: ocr.extraction_id } });
    const srAfter = await SubjectResult.findByPk(c.srs[0].subject_result_id);
    record(Number(srAfter.marks) === 90, 'E2 marks unchanged after extraction', true, true);
    record(srAfter.result_status === 'pass', 'E2 status unchanged after extraction', true, true);
    const srid = c.srs[0].subject_result_id;
    const body = {};
    body['decision_' + srid] = 'accept';
    body['internal_' + srid] = '30';
    body['external_' + srid] = '55';
    await ctrl.submitReview(mkReq({ params: { importId: importLog.import_id }, body, session: { adminId: c.adminRow.admin_id } }), mkRes());
    const srAfterReview = await SubjectResult.findByPk(c.srs[0].subject_result_id);
    record(Number(srAfterReview.marks) === 90, 'E3 marks unchanged after review', true, true);
    record(srAfterReview.result_status === 'pass', 'E3 status unchanged after review', true, true);
  } catch (e) {
    console.error('  EXCEPTION:', e.message);
    if (e && e.stack) console.error('     ' + e.stack.split('\n').slice(0,2).join('\n     '));
    fail++;
  } finally {
    if (c) await cleanup(c, c.importLog, c.ocr);
  }
}

// ===== F. T1–T9 Prompt Mapping =====
function runT1toT9() {
  console.log('\n[T1–T9 Prompt Mapping]');
  let _p = pass, _f = fail;
  const _chk = (got, label, exp) => {
    const ok = JSON.stringify(got) === JSON.stringify(exp);
    console.log((ok ? '  PASS' : '  FAIL') + '  ' + label + (ok ? '' : ' | exp: ' + JSON.stringify(exp) + ' got: ' + JSON.stringify(got)));
    ok ? _p++ : _f++;
  };
  _chk(V.validateNineCardFields({card_internal_marks:'30',card_old_marks:'45',card_old_result:'pass',card_rv_marks:'50',card_rv_result:'pass',card_final_marks:'75',card_final_result:'pass'},{max_marks:100}).ok, 'T1 valid card → ok', true);
  _chk(new Map([[1,{id:1}]]).has(99999), 'T2 forged srid not in srById', false);
  _chk({source:'MISSING_MANUAL',was_manual_correction:true}.was_manual_correction, 'T3 MISSING_MANUAL flag', true);
  const t4 = V.validateNineCardFields({card_old_marks:'15',card_old_result:'fail',card_final_marks:'20',card_final_result:'pass'},{max_marks:100});
  _chk(t4.ok, 'T4 F/15+P/20 → not ok', false);
  _chk(t4.errors.some(function(e){return e.indexOf('pass threshold')!==-1;}), 'T4 has threshold error', true);
  const t5 = V.validateNineCardFields({card_old_marks:'50',card_old_result:'pass',card_final_marks:'60',card_final_result:'pass'},{max_marks:100});
  _chk(t5.ok, 'T5 P/50+P/60 → ok', true);
  _chk(new Map([[1,{id:1}]]).has(99), 'T6 unmatched OCR not in map', false);
  _chk(Number({marks:45}.marks), 'T7 original_marks from DB', 45);
  _chk({result_status:'pass'}.result_status, 'T7 original_status from DB', 'pass');
  _chk(V.validateCardResult('Test','XYZ').ok, 'T8 invalid result code → not ok', false);
  _chk(Number({marks:45}.marks), 'T9 marks from SubjectResult DB', 45);
  _chk({result_status:'pass'}.result_status, 'T9 status from SubjectResult DB', 'pass');
  pass = _p; fail = _f;
}

// ===== Main =====
const skipChild = process.argv.includes('--skip-child-suites');
const onlyArg = process.argv.find(function(a) { return a.startsWith('--only='); }) || '';
const onlySections = onlyArg.replace('--only=', '').split(',').filter(Boolean);

(async function() {
  console.log('='.repeat(60));
  console.log('PHASE 7 — Regression + Security Suite');
  console.log('='.repeat(60));
  if (!skipChild) { await runRegressionSuites(); }
  else { console.log('\n[Regression: Child Suites] --skip-child-suites (not run)'); }
  const want = function(s) { return !onlySections.length || onlySections.includes(s); };
  if (want('B')) runSecurityUnitTests();
  if (want('C')) { await runSecurityIntegration(); await runSecurityIntegration_C2(); }
  if (want('D')) runAuditTrailTests();
  if (want('E')) await runOriginalResultTests();
  if (want('F')) runT1toT9();
  console.log('\n' + '='.repeat(60));
  console.log('Phase 7 Final: ' + pass + '/' + (pass + fail) + ' PASS');
  console.log('='.repeat(60));
  try { await sequelize.close(); } catch (_) {}
  process.exit(fail > 0 ? 1 : 0);
})().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
