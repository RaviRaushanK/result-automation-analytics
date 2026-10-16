'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const policy = require('../services/academicPolicy');

function fixture(approved = true) {
  const state = { approved, countCalls: [], writes: 0, staged: 0, rolledBack: false, lookupFails: false };
  const subject = { subject_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const result = { result_id: 7, student_id: 7, session_id: 20, attempt_no: 1, exam_type: 'REGULAR',
    Student: { student_name: 'TEST STUDENT', usn: '1MV25MC027' },
    ResultSession: { semester: '1', exam_session: 'Jan', exam_year: 2026 },
    SubjectResults: [{ subject_result_id: 1, subject_id: 1, result_id: 7, marks: 40, grade: 'F', result_status: 'fail', Subject: subject }] };
  const saved = { result_id: 7, student_id: 7, session_id: 20, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    student: { name: 'TEST STUDENT', usn: '1MV25MC027' },
    subjects: [{ subject_result_id: 1, subject_code: 'C1', subject_name: 'Course' }],
    ocr: { extraction_status: 'extracted', student_candidates: { name: 'TEST STUDENT', usn: '1MV25MC027' }, subjects: [] } };
  const ocr = { extraction_id: 1, extracted_json: saved, validation_status: 'pending',
    update: async values => { Object.assign(ocr, values); } };
  const log = { import_id: 9, import_type: 'REVALUATION', status: 'extracted', uploaded_by: 1,
    file_name: 'test.pdf', OcrExtractions: [ocr], ResultSession: result.ResultSession };
  const transaction = { LOCK: { UPDATE: 'UPDATE' }, rollback: async () => { state.rolledBack = true; }, commit: async () => {} };
  const forbidden = () => { state.writes++; assert.fail('No academic writes may occur in this test'); };
  const db = {
    Result: { findByPk: async () => result, create: forbidden }, Student: {}, Subject: {},
    SubjectResult: { bulkCreate: forbidden }, ResultSession: {},
    ImportLog: { findByPk: async () => log, create: async () => { state.staged++; return log; } },
    OcrExtraction: { findByPk: async () => ocr, create: async () => { state.staged++; return ocr; } },
    RevaluationResult: { count: async options => {
      state.countCalls.push(options);
      assert.equal(options.include[0].where.result_id, 7);
      if (state.lookupFails) throw new Error('Test lookup failure');
      return state.approved ? 1 : 0;
    }, create: forbidden, update: forbidden },
    sequelize: { transaction: async () => transaction, query: async () => [] }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'controllers/revaluationController.js'), 'utf8'), {
    module, exports: module.exports, console: { error() {}, warn() {}, log() {} }, setTimeout,
    require(name) {
      if (name === '../database/models') return db;
      if (name === 'fs') return { renameSync() {}, unlinkSync() {}, existsSync: () => true };
      if (name === '../middlewares/upload') return { ensureRevalDir() {}, generateSecureFilename: () => 'test.pdf', REVAL_DIR: '/test', REVAL_ALLOWED_EXT: ['.pdf'] };
      if (name === '../services/revaluationValidator' || name === '../services/revaluationPersistence') return {};
      if (name === '../services/revaluationExtractor') return { STATUS_MAP: { P: 'PASS', F: 'FAIL' } };
      if (name === './resultController') return { _test: { gradeFromPercent: policy.gradeFromPercent } };
      return require(name);
    }
  });
  const session = { adminId: 1, revaluationDraft: { resultId: 7 } };
  async function invoke(method, overrides = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      redirect(url) { this.url = url; }, render(view, locals) { this.view = view; this.locals = locals; } };
    await module.exports[method]({ params: { importId: '9', resultId: '7' }, query: {}, session,
      body: { session: 20, student: 7, result: 7, decision_1: 'accept', internal_1: '40', external_1: '40' }, ...overrides }, response);
    return response;
  }
  return { state, invoke, ocr, transaction };
}

test('approved revaluation can reach extraction and editable review without a duplicate alert', async () => {
  const { state, invoke } = fixture();
  assert.equal((await invoke('confirmAttemptSelection')).url, '/revaluation/7/upload');
  assert.equal((await invoke('processUpload', { file: { path: '/test/upload', originalname: 'test.pdf', mimetype: 'application/pdf' } })).url, '/revaluation/pending/9');
  assert.equal(state.staged, 2);
  const extraction = await invoke('showExtraction');
  assert.equal(extraction.view, 'revaluation/extraction');
  assert.equal(extraction.locals.error, null);
  const review = await invoke('showReview');
  assert.equal(review.locals.mode, 'edit');
  assert.equal(review.locals.error, null);
  assert.equal(state.countCalls.length, 0);
  assert.equal(state.writes, 0);
});

test('revaluation duplicate is reported by Save decisions and validate without freezing decisions', async () => {
  const { state, invoke, ocr } = fixture();
  const response = await invoke('submitReview');
  assert.equal(response.statusCode, 422);
  assert.equal(response.view, 'revaluation/review');
  assert.match(response.locals.error, /revaluation result for USN 1MV25MC027 already exists/);
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
  assert.match(decodeURIComponent(response.url), /revaluation result for USN 1MV25MC027 already exists/);
  assert.equal(state.countCalls.at(-1).transaction, transaction);
  assert.equal(state.rolledBack, true);
  assert.equal(state.writes, 0);
});

test('attempt picker allows approved duplicates to reach validation but still protects active drafts', async () => {
  const locals = { studentName: 'TEST', sessionDisplay: 'Jan 2026', sessionId: 20, studentId: 7, error: null,
    attempts: [{ result_id: 7, attempt_no: 1, exam_type: 'REGULAR', result_status: 'pass', reval_state: 'APPROVED' }] };
  const file = path.join(root, 'views/revaluation/result-attempt-picker.ejs');
  const approved = await ejs.renderFile(file, locals);
  assert.match(approved, /action="\/revaluation\/start\/attempt"/);
  assert.doesNotMatch(approved, /disabled title="A revaluation submission/);
  locals.attempts[0].reval_state = 'IN_PROGRESS';
  assert.match(await ejs.renderFile(file, locals), /disabled title="A revaluation submission/);
});
