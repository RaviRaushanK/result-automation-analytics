/**
 * scripts/zz-harness-run.js - Phase 13C end-to-end harness.
 * Walks the revaluation wizard from the upload step onwards. The early
 * pickers (session -> student -> attempt) are pure query/redirect handlers
 * already covered by the Phase 13B-A audit; we pick up at processUpload.
 *
 * Usage:
 *   node scripts/zz-harness-seed.js > /tmp/ids.json
 *   node scripts/zz-harness-run.js < /tmp/ids.json
 *
 *   OR pass ids explicitly:
 *   node scripts/zz-harness-run.js --batchId=1 --sessionId=2 --studentId=3
 *     --resultId=4 --subjectResultIds=5,6,7
 *
 * Checks:
 *   1. processUpload rejects a request with no file (400 BadRequest).
 *   2. runExtraction validates every saved subject_result_id against the
 *      live Result.SubjectResults and writes a full-scope review state.
 *   3. submitReview accepts all rows and sets status='reviewed'.
 *   4. approveReview creates one RevaluationResult per subject, sets
 *      is_effective=true, and stamps reviewed_by.
 *   5. showOutcome renders overlayRows for the full Result scope.
 *
 * Cleans up every row it creates.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const db = require('../database/models');
const {
  Subject, SubjectResult,
  ImportLog, OcrExtraction, RevaluationResult, sequelize
} = db;
const ctrl = require('../controllers/revaluationController');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('  PASS:', name); }
  else      { fail++; console.log('  FAIL:', name); }
};

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      out[k] = rest.length ? rest.join('=') : true;
    }
  }
  return out;
}

async function loadIds() {
  const args = parseArgs();
  if (args.batchId && args.sessionId && args.studentId && args.resultId && args.subjectResultIds) {
    return {
      batchId: Number(args.batchId),
      sessionId: Number(args.sessionId),
      studentId: Number(args.studentId),
      resultId: Number(args.resultId),
      subjectResultIds: String(args.subjectResultIds).split(',').map(Number)
    };
  }
  if (!process.stdin.isTTY) {
    const raw = await new Promise((resolve, reject) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => { buf += c; });
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', reject);
    });
    const j = JSON.parse(raw);
    return {
      batchId: Number(j.batchId),
      sessionId: Number(j.sessionId),
      studentId: Number(j.studentId),
      resultId: Number(j.resultId),
      subjectResultIds: j.subjectResultIds.map(Number)
    };
  }
  throw new Error('No ids. Pipe seed output or pass --batchId/--sessionId/--studentId/--resultId/--subjectResultIds=a,b,c');
}

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

function mkReq({ params, body, query, session, file } = {}) {
  return {
    params: params || {}, body: body || {}, query: query || {},
    session: session || {}, file: file || null,
    app: { get: () => undefined }, protocol: 'http', get: () => 'localhost'
  };
}


// ---------------------------------------------------------------------------
// Step functions
// ---------------------------------------------------------------------------

async function step1_MissingFile(ctrl, ids, adminId) {
  console.log('\n[1] processUpload rejects missing file');
  const req = mkReq({
    params: { resultId: ids.resultId },
    session: { adminId, revaluationDraft: { resultId: ids.resultId } }
  });
  const res = mkRes();
  await ctrl.processUpload(req, res);
  check('processUpload returns 400', res._status === 400);
  check('error mentions file', !!(res._json && res._json.error && /file/i.test(res._json.error)));
}

async function step2_SeedImportLog(ctrl, ids, subjects, adminId) {
  console.log('\n[2] seed ImportLog + OcrExtraction');
  const subjectJson = subjects.map(sr => ({
    subject_result_id: sr.subject_result_id,
    subject_id: sr.subject_id,
    subject_code: sr.Subject ? sr.Subject.subject_code : null,
    subject_name: sr.Subject ? sr.Subject.subject_name : null,
    original_marks: sr.marks,
    original_status: sr.result_status
  }));

  const extracted = {
    result_id: ids.resultId,
    attempt_no: 1,
    exam_type: 'REGULAR',
    ocr_rows: [
      { subject_code: 'RAAS13C_SUBJ1', ocr_code: 'P', confidence: 0.95 },
      { subject_code: 'RAAS13C_SUBJ2', ocr_code: 'F', confidence: 0.90 },
      { subject_code: 'RAAS13C_SUBJ3', ocr_code: 'A', confidence: 0.85 }
    ],
    subjects: subjectJson
  };

  const importLog = await ImportLog.create({
    session_id: ids.sessionId,
    uploaded_by: adminId,
    file_name: '__raas_e2e__.png',
    file_path: '/uploads/__raas_e2e__.png',
    file_type: 'png',
    import_type: 'REVALUATION',
    total_records: subjects.length,
    imported_records: 0,
    skipped_records: 0,
    status: 'pending'
  });

  const ocrExtraction = await OcrExtraction.create({
    import_id: importLog.import_id,
    raw_text: 'RAAS13C_SUBJ1 P\nRAAS13C_SUBJ2 F\nRAAS13C_SUBJ3 A',
    extracted_json: extracted,
    confidence_score: 90.00,
    validation_status: 'pending'
  });

  check('ImportLog created', !!importLog.import_id);
  check('OcrExtraction created', !!ocrExtraction.extraction_id);
  return { importLog, ocrExtraction };
}

async function step3_RunExtraction(ctrl, importId, adminId, subjects) {
  console.log('\n[3] runExtraction writes full-scope review state');
  const req = mkReq({ params: { importId }, session: { adminId } });
  const res = mkRes();
  await ctrl.runExtraction(req, res);
  check('runExtraction redirects to review', /\/revaluation\/review\//.test(res._redirectTo || ''));

  const { RevaluationReviewState } = db;
  const st = await RevaluationReviewState.findOne({ where: { import_id: importId } });
  check('review state row created', !!st);
  if (st) {
    const payload = st.state_json;
    check('review state has all subjects',
      Array.isArray(payload.subjects) && payload.subjects.length === subjects.length);
    check('review state has proposal rows',
      Array.isArray(payload.proposal) && payload.proposal.length >= subjects.length);
    check('every proposal has bound_to_srid',
      payload.proposal.every(p => p.bound_to_srid));
  }
  return st ? st.state_json.proposal : [];
}

async function step4_SubmitReview(ctrl, importId, proposal, adminId) {
  console.log('\n[4] submitReview accepts all rows');
  const body = {
    proposal: proposal.map(p => ({ ...p, action: 'accept' }))
  };
  const req = mkReq({ params: { importId }, body, session: { adminId } });
  const res = mkRes();
  await ctrl.submitReview(req, res);
  check('submitReview redirects to approval', /\/revaluation\/approve\//.test(res._redirectTo || ''));

  const { RevaluationReviewState } = db;
  const after = await RevaluationReviewState.findOne({ where: { import_id: importId } });
  check('review state status=reviewed', after.state_json.status === 'reviewed');
}

async function step5_ApproveReview(ctrl, importId, proposal, adminId, subjects) {
  console.log('\n[5] approveReview persists RevaluationResult is_effective=true');
  const req = mkReq({ params: { importId }, session: { adminId } });
  const res = mkRes();
  await ctrl.approveReview(req, res);
  check('approveReview redirects to outcome', /\/revaluation\/outcome\//.test(res._redirectTo || ''));

  const rows = await RevaluationResult.findAll({
    where: { upload_date: { [db.Sequelize.Op.gte]: new Date(Date.now() - 60_000) } }
  });
  const mine = rows.filter(r => proposal.some(p =>
    (p.bound_to_srid || p.subject_result_id) === r.subject_result_id));

  check('one RevaluationResult per subject', mine.length === subjects.length);
  check('every event is_effective=true', mine.every(r => r.is_effective === true));
  check('every event revaluation_status=approved', mine.every(r => r.revaluation_status === 'approved'));
  check('every event reviewed_by = admin', mine.every(r => Number(r.reviewed_by) === Number(adminId)));
  return mine.map(r => r.revaluation_id);
}

async function step6_ShowOutcome(ctrl, importId, subjects) {
  console.log('\n[6] showOutcome renders overlayRows for full scope');
  const req = mkReq({ params: { importId } });
  const res = mkRes();
  await ctrl.showOutcome(req, res);
  check('showOutcome rendered a view', !!res._rendered);
  check('showOutcome no error redirect', !res._redirectTo);
  if (res._rendered) {
    const v = res._rendered.vars || {};
    check('overlayRows for all subjects',
      Array.isArray(v.overlayRows) && v.overlayRows.length === subjects.length);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let importLog, ocrExtraction, adminRow = null, revalIds = [];
  try {
    const ids = await loadIds();
    console.log('[harness] ids:', ids);

    // Resolve or create an active admin (FK required for uploads)
    const { AdminUser } = db;
    let adminId;
    const anyAdmin = await AdminUser.findOne({ where: { status: 'active' } });
    if (anyAdmin) {
      adminId = anyAdmin.admin_id;
    } else {
      const a = await AdminUser.create({
        admin_uuid: require('crypto').randomUUID(),
        username: '__raas_e2e_admin__',
        email: '__raas_e2e_admin__@raas.local',
        password_hash: 'x',
        role: 'super_admin',
        status: 'active'
      });
      adminId = a.admin_id;
      adminRow = a;
    }
    console.error('[harness] adminId:', adminId);

    // Load SubjectResult fixtures for the test Result
    const subjects = await SubjectResult.findAll({
      where: { result_id: ids.resultId },
      include: [{ model: Subject, attributes: ['subject_code', 'subject_name', 'subject_id'] }],
      order: [['subject_result_id', 'ASC']]
    });
    if (subjects.length === 0) throw new Error(`No SubjectResults found for resultId=${ids.resultId}`);

    // Run steps
    await step1_MissingFile(ctrl, ids, adminId);
    const seeded = await step2_SeedImportLog(ctrl, ids, subjects, adminId);
    importLog = seeded.importLog;
    ocrExtraction = seeded.ocrExtraction;

    const proposal = await step3_RunExtraction(ctrl, importLog.import_id, adminId, subjects);
    await step4_SubmitReview(ctrl, importLog.import_id, proposal, adminId);
    revalIds = await step5_ApproveReview(ctrl, importLog.import_id, proposal, adminId, subjects);
    await step6_ShowOutcome(ctrl, importLog.import_id, subjects);

    console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  } catch (err) {
    console.error('[harness] FATAL:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    for (const r of revalIds) {
      try { await RevaluationResult.destroy({ where: { revaluation_id: r } }); } catch (_) {}
    }
    try { if (ocrExtraction) await OcrExtraction.destroy({ where: { extraction_id: ocrExtraction.extraction_id } }); } catch (_) {}
    try { if (importLog)     await ImportLog.destroy({ where: { import_id: importLog.import_id } }); } catch (_) {}
    try { if (adminRow)      await AdminUser.destroy({ where: { admin_id: adminRow.admin_id } }); } catch (_) {}
    try { await sequelize.close(); } catch (_) {}
    console.log('Cleanup complete.');
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
