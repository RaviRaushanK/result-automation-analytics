/**
 * scripts/test-prompt-14.js — PROMPT 14 acceptance harness.
 *   1. First-time showReview pre-fills from OCR evidence.
 *   2. submitReview re-validates every accepted row through
 *      validateAndComputeRevised (server authoritative).
 *   3. Client-forged total/grade/status in the body are ignored.
 *   4. Frozen proposal lives at OcrExtraction.extracted_json.review with
 *      proposed_revised_*, baselines, and aggregate_preview.
 *   5. Re-opening showReview pre-fills with the admin's last-corrected
 *      marks (NOT raw OCR marks) — and the prior decision radio state.
 *   6. Editing one row and re-submitting REPLACES the frozen proposal
 *      with the newest validated one (latest wins).
 *   7. Out-of-range values are rejected and the existing proposal is
 *      preserved.
 *   8. requireExtracted=true guards review when OCR isn't extracted.
 *   9. approveReview (TX-B) freezes effective events, computes
 *      revaluation_no under lock, refuses double-approval.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const crypto = require('crypto');
const db = require('../database/models');
const {
  Batch, ResultSession, Student, Result, Subject, SubjectResult,
  ImportLog, OcrExtraction, RevaluationResult, AdminUser, sequelize
} = db;
const ctrl = require('../controllers/revaluationController');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('  PASS:', name); }
  else      { fail++; console.log('  FAIL:', name); }
};

function mkRes() {
  const r = {
    _status: 200, _redirectTo: null, _rendered: null, _json: null,
    status(c)  { r._status = c; return r; },
    redirect(u){ r._redirectTo = u; return r; },
    render(v, vars){ r._rendered = { view: v, vars }; return r; },
    json(o)    { r._json = o; return r; }
  };
  return r;
}
function mkReq(o) {
  o = o || {};
  return {
    params: o.params || {}, body: o.body || {}, query: o.query || {},
    session: o.session || {}, file: o.file || null,
    app: { get: () => undefined }, protocol: 'http', get: () => 'localhost',
    headers: {}
  };
}

// ============================================================
// Fixture builder
// ============================================================
async function buildFixtures() {
  const c = {
    batch: null, session: null, student: null, subjects: [], srs: [],
    result: null, importLog: null, ocr: null, adminRow: null, revalIds: []
  };
  const batch = await Batch.create({
    batch_uuid: crypto.randomUUID(), department_id: 1,
    batch_name: '__RAAS_P14__', start_year: 2026, end_year: 2027, status: 'active'
  });
  c.batch = batch;
  const session = await ResultSession.create({
    session_uuid: crypto.randomUUID(), batch_id: batch.batch_id,
    semester: 'Semester P14', exam_session: 'NOV', exam_year: 2026
  });
  c.session = session;
  const student = await Student.create({
    student_uuid: crypto.randomUUID(), batch_id: batch.batch_id,
    usn: 'P14TEST' + Date.now(), student_name: 'Prompt 14 Tester',
    email: 'p14.' + Date.now() + '@raas.local', status: 'active'
  });
  c.student = student;
  const stamp = Date.now().toString().slice(-6);
  const defs = [
    { code: 'P14A_' + stamp, name: 'Algebra',  credits: 4, max_internal: 50, max_external: 100, max_marks: 150, subject_type: 'theory' },
    { code: 'P14B_' + stamp, name: 'Biology',  credits: 3, max_internal: 40, max_external:  60, max_marks: 100, subject_type: 'theory' }
  ];
  for (const d of defs) {
    const s = await Subject.create({
      session_id: session.session_id,
      subject_uuid: crypto.randomUUID(),
      subject_code: d.code,
      subject_name: d.name,
      subject_type: d.subject_type,
      credits: d.credits,
      max_internal: d.max_internal,
      max_external: d.max_external,
      max_marks: d.max_marks
    });
    c.subjects.push(s);
  }
  const result = await Result.create({
    result_uuid: crypto.randomUUID(),
    student_id: student.student_id, session_id: session.session_id,
    attempt_no: 1, exam_type: 'REGULAR',
    sgpa: 7.0, cgpa: 7.0, result_status: 'pass', failed_subject_count: 0
  });
  c.result = result;
  // marks[0]: 90/150 = 60% -> pass (A);  marks[1]: 25/100 = 25% -> fail (F)
  const marksDefs = [
    { idx: 0, marks:  90, grade: 'A', result_status: 'pass' },
    { idx: 1, marks:  25, grade: 'F', result_status: 'fail' }
  ];
  for (const m of marksDefs) {
    const sr = await SubjectResult.create({
      result_id: result.result_id, subject_id: c.subjects[m.idx].subject_id,
      marks: m.marks, grade: m.grade, result_status: m.result_status
    });
    c.srs.push(sr);
  }
  const admin = await AdminUser.create({
    admin_uuid: crypto.randomUUID(), username: '__raas_p14_admin__' + Date.now(),
    email: '__raas_p14_admin__' + Date.now() + '@raas.local',
    password_hash: 'x', role: 'admin', status: 'active'
  });
  c.adminRow = admin;
  const importLog = await ImportLog.create({
    session_id: session.session_id, uploaded_by: admin.admin_id,
    file_name: '__raas_p14__.pdf', file_path: '/uploads/__raas_p14__.pdf',
    file_type: 'pdf', import_type: 'REVALUATION',
    total_records: c.srs.length, imported_records: 0, skipped_records: 0,
    status: 'extracted'
  });
  c.importLog = importLog;
  // OCR evidence: row0 OCR=30/50 (total=80, pass); row1 OCR=15/8 (total=23, fail)
  const subjJson = c.srs.map((sr, i) => ({
    subject_result_id: sr.subject_result_id,
    subject_id: c.subjects[i].subject_id,
    subject_code: c.subjects[i].subject_code,
    subject_name: c.subjects[i].subject_name,
    original_marks: sr.marks,
    original_status: sr.result_status,
    ocr_subject_code: c.subjects[i].subject_code,
    normalized_code: c.subjects[i].subject_code.replace(/[^A-Z0-9]/gi, ''),
    match_state: 'MATCHED',
    revised_internal_marks: i === 0 ? 30 : 15,
    revised_external_marks: i === 0 ? 50 :  8,
    revised_marks: i === 0 ? 80 : 23,
    revised_status_candidate: i === 0 ? 'pass' : 'fail',
    raw_status: null, confidence: 0.95, raw_line: 'OCR line ' + i
  }));
  const extracted = {
    result_id: result.result_id, attempt_no: 1, exam_type: 'REGULAR',
    ocr: {
      extraction_status: 'extracted', extraction_method: 'test',
      warnings: [], unmatched_ocr_codes: [],
      student_candidates: { name: student.student_name, usn: student.usn },
      semester_candidate: 5, subjects: subjJson
    },
    subjects: subjJson,
    student_id: student.student_id, session_id: session.session_id,
    attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    documents: [{ file_name: importLog.file_name, file_url: '/uploads/x.pdf' }]
  };
  const ocr = await OcrExtraction.create({
    import_id: importLog.import_id,
    raw_text: 'P14_A: 30+50\nP14_B: 15+8',
    extracted_json: extracted,
    confidence_score: 95.00, validation_status: 'pending'
  });
  c.ocr = ocr;
  return c;
}

// ============================================================
// Test steps
// ============================================================
async function step1_FirstShowReview(c) {
  console.log('\n[1] showReview first-time (mode=edit, pre-fill from OCR)');
  const r1 = mkRes();
  await ctrl.showReview(mkReq({ params: { importId: c.importLog.import_id } }), r1);
  check('showReview rendered', !!r1._rendered);
  if (!r1._rendered) throw new Error('aborting: no render');
  const v1 = r1._rendered.vars || {};
  check('mode === "edit"', v1.mode === 'edit');
  check('rows count === 2', Array.isArray(v1.rows) && v1.rows.length === 2);
  const row0 = v1.rows.find(r => Number(r.srid) === Number(c.srs[0].subject_result_id));
  const row1 = v1.rows.find(r => Number(r.srid) === Number(c.srs[1].subject_result_id));
  check('row[0] revised_int === 30 (OCR)', row0.evidence.revised_int === 30);
  check('row[0] revised_ext === 50 (OCR)', row0.evidence.revised_ext === 50);
  check('row[1] revised_int === 15 (OCR)', row1.evidence.revised_int === 15);
  check('row[1] revised_ext ===  8 (OCR)', row1.evidence.revised_ext ===  8);
  check('row[0] priorDecision is null', row0.priorDecision === null);
}

async function step2_SubmitReviewWithForgedFields(c) {
  console.log('\n[2] submitReview: admin corrections + forged body fields ignored');
  const body = {};
  body['decision_' + c.srs[0].subject_result_id] = 'accept';
  body['internal_'  + c.srs[0].subject_result_id] = '30';
  body['external_'  + c.srs[0].subject_result_id] = '50';
  // Poison fields - server must never look at these.
  body['proposed_revised_total_marks_' + c.srs[0].subject_result_id] = '999';
  body['proposed_revised_grade_'     + c.srs[0].subject_result_id] = 'O+';
  body['proposed_revised_status_'    + c.srs[0].subject_result_id] = 'pass';
  body['total_' + c.srs[0].subject_result_id] = '999';
  body['grade_' + c.srs[0].subject_result_id] = 'O+';
  // Admin corrects row1.
  body['decision_' + c.srs[1].subject_result_id] = 'accept';
  body['internal_'  + c.srs[1].subject_result_id] = '39';
  body['external_'  + c.srs[1].subject_result_id] = '55';
  const r2 = mkRes();
  await ctrl.submitReview(
    mkReq({ params: { importId: c.importLog.import_id }, body,
            session: { adminId: c.adminRow.admin_id } }),
    r2
  );
  check('submitReview redirected to review',
    !!r2._redirectTo && /\/revaluation\/review\//.test(r2._redirectTo));
  check('submitReview no in-place render',
    !r2._rendered || r2._rendered.view !== 'revaluation/review');

  const frozen1 = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const j1 = frozen1.extracted_json || {};
  const review1 = j1.review || null;
  check('frozen review present', !!review1);
  check('validation_status === validated', frozen1.validation_status === 'validated');
  if (!review1) throw new Error('no frozen review');
  check('proposal has 2 rows',
    Array.isArray(review1.proposal) && review1.proposal.length === 2);
  const fp0 = review1.proposal.find(p => Number(p.subject_result_id) === Number(c.srs[0].subject_result_id));
  const fp1 = review1.proposal.find(p => Number(p.subject_result_id) === Number(c.srs[1].subject_result_id));
  check('row[0] internal === 30', fp0 && Number(fp0.proposed_revised_internal_marks) === 30);
  check('row[0] external === 50', fp0 && Number(fp0.proposed_revised_external_marks) === 50);
  // Server-authoritative total = int + ext (forged 999 must be ignored).
  check('row[0] total === 80 (server computed, NOT forged 999)',
    fp0 && Number(fp0.proposed_revised_total_marks) === 80);
  check('row[0] status === pass (server recomputed from 80/150)',
    fp0 && fp0.proposed_revised_status === 'pass');
  check('row[0] was_manual_correction === false',
    fp0 && fp0.was_manual_correction === false);
  check('row[1] internal === 39 (admin corrected)',
    fp1 && Number(fp1.proposed_revised_internal_marks) === 39);
  check('row[1] external === 55 (admin corrected)',
    fp1 && Number(fp1.proposed_revised_external_marks) === 55);
  check('row[1] total === 94 (server recomputed)',
    fp1 && Number(fp1.proposed_revised_total_marks) === 94);
  check('row[1] status === pass (server recomputed from 94/100)',
    fp1 && fp1.proposed_revised_status === 'pass');
  check('row[1] was_manual_correction === true',
    fp1 && fp1.was_manual_correction === true);
  const b0 = review1.baselines && review1.baselines[String(c.srs[0].subject_result_id)];
  const b1 = review1.baselines && review1.baselines[String(c.srs[1].subject_result_id)];
  check('baseline[0].marks === 90 (original)', b0 && Number(b0.marks) === 90);
  check('baseline[0].status === pass', b0 && b0.status === 'pass');
  check('baseline[1].marks === 25 (original)', b1 && Number(b1.marks) === 25);
  check('baseline[1].status === fail', b1 && b1.status === 'fail');
  check('aggregate_preview.sgpa is finite',
    typeof (review1.aggregate_preview && review1.aggregate_preview.sgpa) === 'number');
  check('aggregate_preview.overall_result === pass',
    review1.aggregate_preview && review1.aggregate_preview.overall_result === 'pass');
}

async function step3_ReopenReviewShowsPriorProposal(c) {
  console.log('\n[3] showReview re-open (locked) - prior proposal marks win over OCR');
  const r3 = mkRes();
  await ctrl.showReview(mkReq({ params: { importId: c.importLog.import_id } }), r3);
  check('showReview re-rendered', !!r3._rendered);
  const v3 = (r3._rendered && r3._rendered.vars) || {};
  check('mode === "locked"', v3.mode === 'locked');
  const r0b = v3.rows.find(r => Number(r.srid) === Number(c.srs[0].subject_result_id));
  const r1b = v3.rows.find(r => Number(r.srid) === Number(c.srs[1].subject_result_id));
  check('row[0] revised_int === 30 (prior proposal)', r0b.evidence.revised_int === 30);
  check('row[0] revised_ext === 50 (prior proposal)', r0b.evidence.revised_ext === 50);
  check('row[1] revised_int === 39 (admin correction, NOT OCR 15)',
    r1b.evidence.revised_int === 39);
  check('row[1] revised_ext === 55 (admin correction, NOT OCR  8)',
    r1b.evidence.revised_ext === 55);
  check('row[0] priorDecision === accept', r0b.priorDecision === 'accept');
  check('row[1] priorDecision === accept', r1b.priorDecision === 'accept');
}

async function step4_ReeditLatestWins(c) {
  console.log('\n[4] re-edit and re-submit - latest validated proposal replaces frozen');
  const body2 = {};
  body2['decision_' + c.srs[0].subject_result_id] = 'accept';
  body2['internal_'  + c.srs[0].subject_result_id] = '30';
  body2['external_'  + c.srs[0].subject_result_id] = '50';
  body2['decision_' + c.srs[1].subject_result_id] = 'accept';
  body2['internal_'  + c.srs[1].subject_result_id] = '19';
  body2['external_'  + c.srs[1].subject_result_id] = '10';
  const r4 = mkRes();
  await ctrl.submitReview(
    mkReq({ params: { importId: c.importLog.import_id }, body: body2,
            session: { adminId: c.adminRow.admin_id } }),
    r4
  );
  check('second submitReview redirected',
    !!r4._redirectTo && /\/revaluation\/review\//.test(r4._redirectTo));
  const frozen2 = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const review2 = (frozen2.extracted_json || {}).review || null;
  const fp1b = review2 && review2.proposal.find(p =>
    Number(p.subject_result_id) === Number(c.srs[1].subject_result_id));
  check('row[1] latest total === 29 (latest wins, NOT prior 94)',
    fp1b && Number(fp1b.proposed_revised_total_marks) === 29);
  check('row[1] latest status === fail (server recomputed)',
    fp1b && fp1b.proposed_revised_status === 'fail');
  const bb1 = review2 && review2.baselines &&
    review2.baselines[String(c.srs[1].subject_result_id)];
  check('baselines[1] still === original 25/fail after re-submit',
    bb1 && Number(bb1.marks) === 25 && bb1.status === 'fail');
}

async function step5_ReopenAfterReedit(c) {
  console.log('\n[5] re-open review - pre-fill matches latest frozen proposal');
  const r5 = mkRes();
  await ctrl.showReview(mkReq({ params: { importId: c.importLog.import_id } }), r5);
  const v5 = (r5._rendered && r5._rendered.vars) || {};
  const r1c = v5.rows && v5.rows.find(r =>
    Number(r.srid) === Number(c.srs[1].subject_result_id));
  check('row[1] revised_int === 19 (latest correction)',
    r1c && r1c.evidence.revised_int === 19);
  check('row[1] revised_ext === 10 (latest correction)',
    r1c && r1c.evidence.revised_ext === 10);
  check('row[1] priorDecision === accept',
    r1c && r1c.priorDecision === 'accept');
}

async function step6_OutOfRangeRejected(c) {
  console.log('\n[6] out-of-range input rejected; existing proposal preserved');
  const body3 = {};
  body3['decision_' + c.srs[0].subject_result_id] = 'accept';
  body3['internal_'  + c.srs[0].subject_result_id] = '999';
  body3['external_'  + c.srs[0].subject_result_id] = '50';
  body3['decision_' + c.srs[1].subject_result_id] = 'accept';
  body3['internal_'  + c.srs[1].subject_result_id] = '19';
  body3['external_'  + c.srs[1].subject_result_id] = '10';
  const r6 = mkRes();
  await ctrl.submitReview(
    mkReq({ params: { importId: c.importLog.import_id }, body: body3,
            session: { adminId: c.adminRow.admin_id } }),
    r6
  );
  check('invalid submitReview re-renders review page',
    !!r6._rendered && r6._rendered.view === 'revaluation/review');
  const v6 = r6._rendered && r6._rendered.vars;
  check('errors contain row[0] error',
    v6 && v6.errors && v6.errors[c.srs[0].subject_result_id]
    && v6.errors[c.srs[0].subject_result_id].length > 0);
  const frozen3 = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const review3 = (frozen3.extracted_json || {}).review || null;
  const fp1c = review3 && review3.proposal.find(p =>
    Number(p.subject_result_id) === Number(c.srs[1].subject_result_id));
  check('frozen row[1] still 29 (failed edit did NOT overwrite)',
    fp1c && Number(fp1c.proposed_revised_total_marks) === 29);
  return frozen3;
}

async function step7_RequireExtractedGuard(c, frozen3) {
  console.log('\n[7] requireExtracted guard - redirects when OCR not extracted');
  // Use raw query to be sure the JSON column actually changes.
  const ocrId = frozen3.extraction_id;
  const [rows] = await OcrExtraction.sequelize.query(
    'SELECT extracted_json FROM ocr_extractions WHERE extraction_id = ?',
    { replacements: [ocrId] }
  );
  const before = (rows[0] && typeof rows[0].extracted_json === 'string')
    ? JSON.parse(rows[0].extracted_json) : rows[0].extracted_json;
  if (!before.ocr) before.ocr = {};
  before.ocr.extraction_status = 'pending';
  await OcrExtraction.sequelize.query(
    'UPDATE ocr_extractions SET extracted_json = ? WHERE extraction_id = ?',
    { replacements: [JSON.stringify(before), ocrId] }
  );
  // Verify the write took effect.
  const [vrows] = await OcrExtraction.sequelize.query(
    'SELECT extracted_json FROM ocr_extractions WHERE extraction_id = ?',
    { replacements: [ocrId] }
  );
  const after = (vrows[0] && typeof vrows[0].extracted_json === 'string')
    ? JSON.parse(vrows[0].extracted_json) : vrows[0].extracted_json;
  console.log('  [diag] extraction_status after write:', after.ocr && after.ocr.extraction_status);
  const r7 = mkRes();
  await ctrl.showReview(mkReq({ params: { importId: c.importLog.import_id } }), r7);
  if (!r7._redirectTo) {
    console.log('  [diag] redirect URL:', r7._redirectTo, ' rendered:', r7._rendered && r7._rendered.view);
  }
  check('showReview redirected (not rendered) when OCR not extracted',
    !!r7._redirectTo);
  check('redirect target contains /pending/ or /extraction/',
    !!(r7._redirectTo && (/\/revaluation\/pending\//.test(r7._redirectTo) || /\/revaluation\/extraction\//.test(r7._redirectTo))));
  // Restore so step 8 can run.
  after.ocr.extraction_status = 'extracted';
  await OcrExtraction.sequelize.query(
    'UPDATE ocr_extractions SET extracted_json = ? WHERE extraction_id = ?',
    { replacements: [JSON.stringify(after), ocrId] }
  );
}

async function step8_ApproveReview(c) {
  console.log('\n[8] approveReview creates effective RevaluationResult events');
  const r8 = mkRes();
  await ctrl.approveReview(
    mkReq({ params: { importId: c.importLog.import_id },
            session: { adminId: c.adminRow.admin_id } }),
    r8
  );
  check('approveReview redirected to /outcome/',
    !!r8._redirectTo && /\/revaluation\/outcome\//.test(r8._redirectTo));
  const events = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  const ev0 = events.find(e => Number(e.subject_result_id) === Number(c.srs[0].subject_result_id));
  const ev1 = events.find(e => Number(e.subject_result_id) === Number(c.srs[1].subject_result_id));
  check('one event per subject', events.length === 2);
  check('ev0 is_effective === true', ev0 && ev0.is_effective === true);
  check('ev0 revised_marks === 80', ev0 && Number(ev0.revised_marks) === 80);
  check('ev0 revised_status === pass', ev0 && ev0.revised_status === 'pass');
  check('ev0 original_marks unchanged 90', ev0 && Number(ev0.original_marks) === 90);
  check('ev0 revaluation_status === approved', ev0 && ev0.revaluation_status === 'approved');
  check('ev0 reviewed_by === admin', ev0 && Number(ev0.reviewed_by) === Number(c.adminRow.admin_id));
  check('ev0 revaluation_no === 1', ev0 && Number(ev0.revaluation_no) === 1);
  check('ev1 is_effective === true', ev1 && ev1.is_effective === true);
  check('ev1 revised_marks === 29 (latest correction)', ev1 && Number(ev1.revised_marks) === 29);
  check('ev1 revised_status === fail (latest correction)', ev1 && ev1.revised_status === 'fail');
  check('ev1 original_marks unchanged 25', ev1 && Number(ev1.original_marks) === 25);
  check('ev1 reviewed_by === admin', ev1 && Number(ev1.reviewed_by) === Number(c.adminRow.admin_id));
  check('ev1 revaluation_no === 1', ev1 && Number(ev1.revaluation_no) === 1);
  c.revalIds = events.map(e => e.revaluation_id);
}

async function step9_DoubleApprovalNoDuplicate(c) {
  console.log('\n[9] double-approval does not create duplicate events');
  const r9 = mkRes();
  await ctrl.approveReview(
    mkReq({ params: { importId: c.importLog.import_id },
            session: { adminId: c.adminRow.admin_id } }),
    r9
  );
  check('second approval redirects to outcome',
    !!r9._redirectTo && /\/revaluation\/outcome\//.test(r9._redirectTo));
  const events2 = await RevaluationResult.findAll({
    where: { subject_result_id: c.srs.map(s => s.subject_result_id) }
  });
  check('still exactly 2 events after second approval', events2.length === 2);
  for (const e of events2) {
    if (!c.revalIds.includes(e.revaluation_id)) c.revalIds.push(e.revaluation_id);
  }
}

// ============================================================
// Entry
// ============================================================
(async () => {
  let created;
  try {
    created = await buildFixtures();
    await step1_FirstShowReview(created);
    await step2_SubmitReviewWithForgedFields(created);
    await step3_ReopenReviewShowsPriorProposal(created);
    await step4_ReeditLatestWins(created);
    await step5_ReopenAfterReedit(created);
    const frozen3 = await step6_OutOfRangeRejected(created);
    await step7_RequireExtractedGuard(created, frozen3);
    await step8_ApproveReview(created);
    await step9_DoubleApprovalNoDuplicate(created);
    console.log(`\n==== PROMPT 14: ${pass} passed, ${fail} failed ====`);
  } catch (err) {
    console.error('FATAL:', err.message);
    console.error(err.stack);
    fail++;
    console.log(`\n==== PROMPT 14: ${pass} passed, ${fail} failed ====`);
  } finally {
    if (created) {
      for (const id of created.revalIds) {
        try { await RevaluationResult.destroy({ where: { revaluation_id: id } }); } catch (_) {}
      }
      try { if (created.ocr)     await OcrExtraction.destroy({ where: { extraction_id: created.ocr.extraction_id } }); } catch (_) {}
      try { if (created.importLog) await ImportLog.destroy({ where: { import_id: created.importLog.import_id } }); } catch (_) {}
      try { if (created.srs.length) await SubjectResult.destroy({ where: { subject_result_id: created.srs.map(s => s.subject_result_id) } }); } catch (_) {}
      try { if (created.result) await Result.destroy({ where: { result_id: created.result.result_id } }); } catch (_) {}
      try { for (const s of created.subjects) { try { await Subject.destroy({ where: { subject_id: s.subject_id } }); } catch (_) {} } } catch (_) {}
      try { if (created.session) await ResultSession.destroy({ where: { session_id: created.session.session_id } }); } catch (_) {}
      try { if (created.student) await Student.destroy({ where: { student_id: created.student.student_id } }); } catch (_) {}
      try { if (created.adminRow) await AdminUser.destroy({ where: { admin_id: created.adminRow.admin_id } }); } catch (_) {}
      try { if (created.batch)   await Batch.destroy({ where: { batch_id: created.batch.batch_id } }); } catch (_) {}
    }
    try { await sequelize.close(); } catch (_) {}
    console.log('Cleanup complete.');
    process.exit(fail === 0 ? 0 : 1);
  }
})();

