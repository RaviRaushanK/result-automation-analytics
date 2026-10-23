'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const policy = require('../services/academicPolicy');
const integrity = require('../services/revaluationIntegrity');

function fixture(approved = true) {
  const state = { approved, countCalls: [], writes: 0, staged: 0, rolledBack: false, lookupFails: false, extractions: 0, extractionFails: false };
  const subject = { subject_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const result = { result_id: 7, student_id: 7, exam_session_id: 20, attempt_no: 1, exam_type: 'REGULAR',
    Student: { student_name: 'TEST STUDENT', usn: '1MV25MC027' },
    ExamSession: { semester: '1', exam_session: 'Jan', exam_year: 2026 },
    SubjectResults: [{ subject_result_id: 1, subject_id: 1, result_id: 7, marks: 40, grade: 'F', result_status: 'fail', Subject: subject }] };
  const saved = { result_id: 7, student_id: 7, exam_session_id: 20, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    student: { name: 'TEST STUDENT', usn: '1MV25MC027' },
    subjects: [{ subject_result_id: 1, subject_code: 'C1', subject_name: 'Course' }],
    ocr: { extraction_status: 'extracted', student_candidates: { name: 'TEST STUDENT', usn: '1MV25MC027' }, subjects: [] } };
  const ocr = { extraction_id: 1, extracted_json: saved, validation_status: 'pending',
    update: async values => { Object.assign(ocr, values); } };
  const log = { import_id: 9, import_type: 'REVALUATION', status: 'extracted', uploaded_by: 1,
    file_name: 'test.pdf', OcrExtractions: [ocr], ExamSession: result.ExamSession,
    update: async values => Object.assign(log, values) };
  const transaction = { LOCK: { UPDATE: 'UPDATE' }, rollback: async () => { state.rolledBack = true; }, commit: async () => {} };
  const forbidden = () => { state.writes++; assert.fail('No academic writes may occur in this test'); };
  const db = {
    Result: { findByPk: async () => result, findAll: async () => [result], create: forbidden },
    Student: { findByPk: async () => result.Student }, Subject: {},
    SubjectResult: { bulkCreate: forbidden }, ExamSession: { findByPk: async () => result.ExamSession },
    ImportLog: { findByPk: async () => log, create: async values => { state.staged++; Object.assign(log, values); return log; } },
    OcrExtraction: { findByPk: async () => ocr, create: async values => { state.staged++; Object.assign(ocr, values); return ocr; } },
    RevaluationResult: { findAll: async options => {
      if (!options.where.subject_result_id) return [];
      state.countCalls.push(options);
      if (state.lookupFails) throw new Error('Test lookup failure');
      return state.approved ? [{ subject_result_id: 1, remarks: JSON.stringify({ event_fingerprint:
        state.differentDocument ? 'a-different-document' : integrity.eventFingerprint(ocr.extracted_json, 1) }) }] : [];
    }, count: async options => {
      state.countCalls.push(options);
      assert.equal(options.include[0].where.result_id, 7);
      if (state.lookupFails) throw new Error('Test lookup failure');
      return state.approved ? 1 : 0;
    }, create: forbidden, update: forbidden },
    sequelize: { transaction: async () => transaction, query: async () => {
      if (state.openLookupFails) throw new Error('Open import lookup unavailable');
      return state.openImportId ? [{ import_id: state.openImportId, status: 'extracted', extracted_json: ocr.extracted_json }] : [];
    } }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'controllers/revaluationController.js'), 'utf8'), {
    module, exports: module.exports, console: { error() {}, warn() {}, log() {} }, setTimeout,
    require(name) {
      if (name === '../database/models') return db;
      if (name === 'fs') return { renameSync() {}, unlinkSync() {}, existsSync: () => true, readFileSync: () => Buffer.from('isolated document') };
      if (name === '../middlewares/upload') return { ensureRevalDir() {}, generateSecureFilename: name => 'test' + path.extname(name).toLowerCase(), REVAL_DIR: '/test', REVAL_ALLOWED_EXT: ['.pdf'] };
      if (name === '../services/revaluationValidator' || name === '../services/revaluationPersistence') return {};
      if (name === '../services/revaluationExtractor') return { STATUS_MAP: { P: 'PASS', F: 'FAIL' },
        extractAndBuild: async () => {
          state.extractions++;
          if (state.duringExtraction) state.duringExtraction();
          if (state.extractionFails) throw new Error('Test extraction failure');
          return { ok: true, ocr: { extraction_status: 'extracted',
            student_candidates: { name: 'TEST STUDENT', usn: '1MV25MC027' }, subjects: [], warnings: [] } };
        }
      };
      if (name === './resultController') return { _test: { gradeFromPercent: policy.gradeFromPercent } };
      return require(name);
    }
  });
  const session = { adminId: 1, revaluationDraft: { resultId: 7 } };
  async function invoke(method, overrides = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      redirect(url) { this.url = url; }, render(view, locals) { this.view = view; this.locals = locals; } };
    await module.exports[method]({ params: { importId: '9', resultId: '7' }, query: {}, session,
      body: { exam_session_id: 20, student: 7, result: 7, decision_1: 'accept', internal_1: '40', external_1: '40',
        source_token: integrity.digest(ocr.extracted_json), review_token: integrity.digest(ocr.extracted_json.review), verify_usn: '1', verify_semester: '1', verify_period: '1', verify_old_marks: '1', verify_old_status: '1' }, ...overrides }, response);
    return response;
  }
  return { state, invoke, ocr, log, result, transaction, controller: module.exports, session };
}

test('approved revaluation can reach extraction and editable review without a duplicate alert', async () => {
  const { state, invoke } = fixture();
  assert.equal((await invoke('confirmAttemptSelection')).url, '/revaluation/7/upload');
  assert.equal((await invoke('processUpload', { file: { path: '/test/upload', originalname: 'test.pdf', mimetype: 'application/pdf' } })).url, '/revaluation/review/9');
  assert.equal(state.staged, 2);
  const extraction = await invoke('showExtraction');
  assert.equal(extraction.url, '/revaluation/review/9');
  const review = await invoke('showReview');
  assert.equal(review.locals.mode, 'edit');
  assert.equal(review.locals.error, null);
  assert.equal(state.countCalls.length, 0);
  assert.equal(state.writes, 0);
});

for (const ext of ['png', 'jpg', 'jpeg']) {
  test('revaluation ' + ext + ' upload reaches editable preview with the stored image type', async () => {
    const { invoke, state, log, ocr } = fixture(false);
    const response = await invoke('processUpload', {
      file: { path: '/test/upload', originalname: 'card.' + ext, mimetype: ext === 'png' ? 'image/png' : 'image/jpeg', size: 100 }
    });
    assert.equal(response.url, '/revaluation/review/9');
    assert.equal(log.file_type, ext);
    assert.equal(ocr.extracted_json.documents[0].file_type, ext);
    const preview = await invoke('showReview');
    assert.equal(preview.locals.meta.docType, ext);
    const html = await ejs.renderFile(path.join(root, 'views/revaluation/review.ejs'), preview.locals);
    assert.match(html, /class="revaluation-document-image"/);
    assert.doesNotMatch(html, /<iframe/);
    assert.equal(ocr.validation_status, 'pending');
    assert.equal(state.writes, 0);
    assert.equal(state.countCalls.length, 0);
  });
}

for (const scenario of ['available', 'in_progress', 'lookup_failed']) {
  test('Continue follows registered routes for ' + scenario + ' attempts', async () => {
    const { state, controller, session, ocr } = fixture(false);
    delete session.revaluationDraft;
    if (scenario === 'in_progress') state.openImportId = 9;
    if (scenario === 'lookup_failed') state.openLookupFails = true;

    const routeModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'routes/revaluationRoutes.js'), 'utf8'), {
      module: routeModule, exports: routeModule.exports,
      require(name) {
        if (name === '../controllers/revaluationController') return controller;
        if (name === '../middlewares/upload') return { revaluationUpload: { single: () => (req,res,next) => next() } };
        return require(name);
      }
    });
    const express = require('express');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(root, 'views'));
    app.use(express.urlencoded({ extended: false }));
    app.use((req,res,next) => { req.session = session; next(); });
    app.use('/revaluation', routeModule.exports);
    app.use((req,res) => res.status(404).send('Route not found'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/revaluation/start/attempt', {
        method: 'POST', body: new URLSearchParams({ session: '20', student: '7', result: '7' })
      });
      assert.equal(response.status, 200, response.url);
      const html = await response.text();
      if (scenario === 'available') {
        assert.equal(new URL(response.url).pathname, '/revaluation/7/upload');
        assert.match(html, /id="uploadForm"/);
        assert.equal(session.revaluationDraft.resultId, 7);
      } else if (scenario === 'in_progress') {
        assert.equal(new URL(response.url).pathname, '/revaluation/review/9');
        assert.match(html, /id="validateRevaluationBtn"/);
        assert.equal(session.revaluationDraft, undefined);
      } else {
        const url = new URL(response.url);
        assert.equal(url.pathname, '/revaluation/start/attempts');
        assert.equal(url.searchParams.get('exam_session_id'), '20');
        assert.equal(url.searchParams.get('student'), '7');
        assert.match(html, /Could not verify existing revaluation submissions/);
        assert.equal(session.revaluationDraft, undefined);
      }
      assert.equal(state.staged, 0);
      assert.equal(state.writes, 0);
      assert.equal(ocr.validation_status, 'pending');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('Continue still rejects a result belonging to a different selected student or session', async () => {
  const { invoke, state } = fixture(false);
  for (const body of [{ session: 99, student: 7, result: 7 }, { session: 20, student: 99, result: 7 }]) {
    const response = await invoke('confirmAttemptSelection', { body });
    assert.match(response.url, /^\/revaluation\/start\?error=/);
  }
  assert.equal(state.staged, 0);
  assert.equal(state.writes, 0);
});

test('extracted preview preserves genuine zero marks in all numeric card evidence', async () => {
  const { invoke, ocr } = fixture(false);
  ocr.extracted_json.ocr.subjects = [{
    subject_result_id: 1, match_state: 'MATCHED', revised_internal_marks: 0, revised_external_marks: 0,
    internalMarks: 0, oldMarks: 0, rvMarks: 0, finalMarks: 0
  }];
  const preview = await invoke('showReview');
  const row = preview.locals.rows[0];
  for (const key of ['internalMarks', 'oldMarks', 'rvMarks', 'finalMarks', 'revised_int', 'revised_ext']) {
    assert.equal(row.evidence[key], 0, key + ' must remain zero');
  }
});

test('legacy extraction and approval links open the canonical preview and recovery does not loop', async () => {
  const { invoke, state } = fixture(false);
  assert.equal((await invoke('showExtraction')).url, '/revaluation/review/9');
  assert.equal((await invoke('showApproveConfirm')).url, '/revaluation/review/9');
  assert.equal((await invoke('showPending', { query: { error: 'Stored context needs correction.' } })).view, 'revaluation/pending');
  assert.equal(state.writes, 0);
});

test('upload extracts once and opens an editable preview before any validation or academic writes', async () => {
  const { invoke, state, ocr } = fixture(false);
  const response = await invoke('processUpload', { file: { path: '/test/upload', originalname: 'test.pdf', mimetype: 'application/pdf' } });
  assert.equal(response.url, '/revaluation/review/9');
  assert.equal(state.extractions, 1);
  assert.equal(ocr.validation_status, 'pending');
  assert.equal(ocr.extracted_json.review, undefined);
  assert.equal(state.writes, 0);
  assert.equal(state.countCalls.length, 0);
});

test('failed extraction offers retry and cannot reach the review or approval stages', async () => {
  const { invoke, state, ocr, log } = fixture(false);
  state.extractionFails = true;
  const response = await invoke('processUpload', { file: { path: '/test/upload', originalname: 'test.pdf', mimetype: 'application/pdf' } });
  assert.equal(response.url, '/revaluation/pending/9');
  assert.equal(log.status, 'failed');
  assert.equal(ocr.validation_status, 'pending');
  assert.equal((await invoke('showPending')).view, 'revaluation/pending');
  assert.match((await invoke('submitReview')).url, /pending\/9/);
  assert.match((await invoke('approveReview')).url, /error=/);
  assert.equal(state.writes, 0);
  state.extractionFails = false;
  assert.equal((await invoke('runExtraction')).url, '/revaluation/review/9');
  assert.equal(state.extractions, 2);
});

test('identity mismatch remains visible on preview and direct Validate cannot bypass it', async () => {
  const { invoke, state, ocr } = fixture(false);
  ocr.extracted_json.ocr.student_candidates = { name: 'OTHER STUDENT', usn: '1MV25MC099' };
  const preview = await invoke('showReview');
  assert.equal(preview.locals.identityBlocking, true);
  const html = await ejs.renderFile(path.join(root, 'views/revaluation/review.ejs'), preview.locals);
  assert.match(html, /id="validateRevaluationBtn"[^>]*disabled/);
  assert.match(html, /action="\/revaluation\/pending\/9\/confirm-identity"/);
  const validate = await invoke('submitReview', { body: { identity_confirmed: 'true' } });
  assert.match(validate.url, /^\/revaluation\/review\/9\?error=/);
  assert.equal(ocr.validation_status, 'pending');
  assert.equal(state.writes, 0);
  assert.equal(state.countCalls.length, 0);
});

test('approval is blocked before Validate and successful extraction cannot reset a validated preview', async () => {
  const { invoke, state, ocr } = fixture(false);
  assert.match((await invoke('approveReview')).url, /error=/);
  assert.equal(state.writes, 0);
  await invoke('submitReview');
  const frozen = JSON.stringify(ocr.extracted_json.review);
  assert.equal((await invoke('runExtraction')).url, '/revaluation/review/9');
  assert.equal(state.extractions, 0);
  assert.equal(JSON.stringify(ocr.extracted_json.review), frozen);
  assert.equal(ocr.validation_status, 'validated');
  const locked = await invoke('showReview');
  assert.equal(locked.locals.mode, 'locked');
  assert.equal((await invoke('showReview', { query: { edit: '1' } })).locals.mode, 'edit');
  assert.equal(state.writes, 0);
});

test('old pending links resume a successful preview without extra screens', async () => {
  const { invoke, state } = fixture(false);
  assert.equal((await invoke('showPending')).url, '/revaluation/review/9');
  assert.equal(state.writes, 0);
});

test('late OCR completion preserves a review that another request already validated', async () => {
  const { invoke, state, ocr, log } = fixture(false);
  delete ocr.extracted_json.ocr;
  ocr.extracted_json.documents = [{ file_path: '/test/document.pdf' }];
  state.duringExtraction = () => {
    ocr.extracted_json = { ...ocr.extracted_json, ocr: { extraction_status: 'extracted' }, review: { proposal: [] } };
    ocr.validation_status = 'validated';
    log.status = 'extracted';
  };
  assert.equal((await invoke('runExtraction')).url, '/revaluation/review/9');
  assert.equal(ocr.validation_status, 'validated');
  assert.ok(ocr.extracted_json.review);
  assert.equal(state.writes, 0);
});

test('revaluation duplicate is reported by Save decisions and validate without freezing decisions', async () => {
  const { state, invoke, ocr } = fixture();
  const response = await invoke('submitReview');
  assert.equal(response.statusCode, 422);
  assert.equal(response.view, 'revaluation/review');
  assert.match(response.locals.error, /document has already been approved/);
  assert.equal(response.locals.validationFailed, true);
  assert.equal(ocr.validation_status, 'pending');
  const html = await ejs.renderFile(path.join(root, 'views/revaluation/review.ejs'), response.locals);
  assert.match(html, /<strong>Validation Failed<\/strong>/);
  assert.equal(state.writes, 0);
});

test('a nonduplicate revaluation still validates normally', async () => {
  const { invoke, ocr } = fixture(false);
  assert.equal((await invoke('submitReview')).url, '/revaluation/review/9');
  assert.equal(ocr.validation_status, 'validated');
});

test('revaluation validation fails closed if duplicate lookup fails', async () => {
  const { state, invoke, ocr } = fixture();
  state.lookupFails = true;
  const response = await invoke('submitReview');
  assert.equal(response.statusCode, 422);
  assert.match(response.locals.error, /Could not verify existing revaluation results/);
  assert.equal(ocr.validation_status, 'pending');
});

test('final approval rejects a duplicate that appeared after validation under the Result lock', async () => {
  const { state, invoke, transaction } = fixture(false);
  assert.equal((await invoke('submitReview')).url, '/revaluation/review/9');
  state.approved = true;
  const response = await invoke('approveReview');
  assert.match(decodeURIComponent(response.url), /document has already been approved/);
  assert.equal(state.countCalls.at(-1).transaction, transaction);
  assert.equal(state.rolledBack, true);
  assert.equal(state.writes, 0);
});

test('attempt picker allows approved duplicates to reach validation but still protects active drafts', async () => {
  const locals = { studentName: 'TEST', sessionDisplay: 'Jan 2026', examSessionId: 20, studentId: 7, error: null,
    attempts: [{ result_id: 7, attempt_no: 1, exam_type: 'REGULAR', result_status: 'pass', reval_state: 'APPROVED' }] };
  const file = path.join(root, 'views/revaluation/result-attempt-picker.ejs');
  const approved = await ejs.renderFile(file, locals);
  assert.match(approved, /action="\/revaluation\/start\/attempt"/);
  assert.doesNotMatch(approved, /disabled title="A revaluation submission/);
  locals.attempts[0].reval_state = 'IN_PROGRESS';
  assert.match(await ejs.renderFile(file, locals), /disabled title="A revaluation submission/);
});
for (const value of ['50abc', '35.9', '1e3', [], [40], {}, null, Infinity, -1, 51]) {
  test('direct review submission rejects malformed revised marks ' + JSON.stringify(value), async () => {
    const f = fixture(false);
    const response = await f.invoke('submitReview', { body: { source_token: integrity.digest(f.ocr.extracted_json), verify_usn: '1', verify_semester: '1', verify_period: '1', verify_old_marks: '1', verify_old_status: '1',
      decision_1: 'accept', internal_1: value, external_1: '40', is_effective: true, revaluation_status: 'approved' } });
    assert.equal(response.statusCode, 422); assert.equal(f.ocr.validation_status, 'pending'); assert.equal(f.state.writes, 0);
  });
}
