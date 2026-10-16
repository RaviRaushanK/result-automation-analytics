'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
function card(semester, extra = {}) {
  return { result_id: semester, student_id: 7, session_id: semester, attempt_no: 1,
    exam_type: 'REGULAR', result_status: 'fail',
    ResultSession: { session_id: semester, batch_id: 1, semester: String(semester), exam_session: 'Jan', exam_year: 2026 },
    SubjectResults: [{ subject_result_id: semester }], ...extra };
}

function fixture({ semester = 2, history = [], student = true, duplicate = false, attempt = { attempt_no: 1, exam_type: 'REGULAR' } } = {}) {
  const state = { history, duplicate, updates: [], results: [], subjects: [], students: [], committed: false, rolledBack: false, historyReads: [] };
  const session = { session_id: 20, batch_id: 1, semester: String(semester), exam_session: 'Jul', exam_year: 2026, Batch: { batch_name: 'MCA 2025' } };
  const person = student ? { student_id: 7, batch_id: 1, usn: '1MV25MC027', student_name: 'TEST STUDENT' } : null;
  const definition = { subject_id: 1, course_id: 1, subject_type: 'theory', subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const log = { import_id: 9, file_name: 'test.pdf', file_type: 'pdf', ResultSession: session, update: async values => state.updates.push(values) };
  const ocr = { extracted_json: { student: { usn: '1MV25MC027', name: 'TEST STUDENT' }, attempt,
    subjects: [{ subject_id: 1, internalMarks: 40, externalMarks: 40 }] }, validation_status: 'validated',
  async update(values) { state.updates.push(values); Object.assign(this, values); } };
  const transaction = { commit: async () => { state.committed = true; }, rollback: async () => { state.rolledBack = true; } };
  const db = {
    ImportLog: { findByPk: async () => log }, OcrExtraction: { findOne: async () => ocr },
    ResultSession: { findByPk: async () => session }, Batch: {},
    Student: { findOne: async () => person, findByPk: async () => person,
      create: async values => { state.students.push(values); return { student_id: 7, ...values }; } },
    Subject: { findAll: async () => [definition] },
    AcademicCourse: { findAll: async () => [{ ...definition, semester: String(semester), is_required: true, roster_verified: true, status: 'active' }] },
    SubjectResult: { bulkCreate: async values => { state.subjects.push(...values); } },
    Result: {
      findOne: async options => {
        assert.equal(options.where.student_id, 7);
        assert.equal(options.where.session_id, 20);
        return state.duplicate && Number(options.where.attempt_no) === 1 ? { result_id: 99 } : null;
      },
      findAll: async options => {
        state.historyReads.push(options);
        assert.equal(options.where.student_id, 7);
        assert.equal(options.where.exam_type, 'REGULAR');
        assert.equal(options.include[0].required, true);
        assert.equal(options.include[0].where.batch_id, 1);
        assert.equal(options.include[1].required, true);
        return state.history.filter(row => row.student_id === options.where.student_id && row.exam_type === options.where.exam_type &&
          row.ResultSession.batch_id === options.include[0].where.batch_id && row.SubjectResults.length);
      },
      create: async values => { state.results.push(values); return { result_id: 100, ...values }; }
    },
    sequelize: { transaction: async () => transaction }
  };
  const policy = require('../services/academicPolicy');
  const historyModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/resultHistoryService.js'), 'utf8'), {
    module: historyModule, exports: historyModule.exports,
    require(name) { if (name === '../database/models') return db; if (name === './academicPolicy') return policy; throw new Error(name); }
  });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'controllers/resultController.js'), 'utf8'), {
    module, exports: module.exports, console, __dirname: path.join(root, 'controllers'),
    require(name) {
      if (name === '../database/models') return db;
      if (name === '../services/documentExtractor') return {};
      if (name === '../services/academicPolicy') return policy;
      if (name === '../services/resultHistoryService') return historyModule.exports;
      if (name === '../public/js/academic-form-options') return { sortBatches: values => values };
      if (name === '../services/academicOutcomeService') return { retakeWarnings: async () => [], calculateCumulative: async () => null, load: async () => ({}), previewCumulative: () => null };
      return require(name);
    }
  });
  async function invoke(method, overrides = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      render(view, locals) { this.view = view; this.locals = locals; }, redirect(url) { this.url = url; }, json(data) { this.data = data; } };
    await module.exports[method]({ params: { importId: '9' }, query: {},
      body: { usn: '1MV25MC027', name: 'TEST STUDENT', internal_1: '40', external_1: '40', student_id: 7, session_id: 20 }, ...overrides }, response);
    return response;
  }
  return { state, session, ocr, transaction, invoke };
}

test('Validate shows missing previous result after extraction and keeps staging pending', async () => {
  const { invoke, state, ocr } = fixture();
  const initial = await invoke('showReviewPage');
  assert.equal(initial.locals.formError, null);
  const result = await invoke('validateReview');
  assert.equal(result.statusCode, 422);
  assert.equal(result.view, 'results/review');
  assert.match(result.locals.formError, /Previous result card missing: Semester 1.*1MV25MC027.*MCA 2025/);
  assert.equal(result.locals.extractionWarning, null);
  assert.equal(ocr.validation_status, 'pending');
  assert.equal(state.results.length, 0);
  const html = await ejs.renderFile(path.join(root, 'views/results/review.ejs'), result.locals);
  assert.match(html, /<strong>Validation Failed<\/strong>/);
  assert.match(html, /Upload the original result card/);
});

test('direct preview and import cannot bypass missing history even with validated staging', async () => {
  const { invoke, state, transaction } = fixture();
  const preview = await invoke('showPreviewPage');
  assert.match(decodeURIComponent(preview.url), /review\?error=Previous result card missing: Semester 1/);
  const review = await invoke('showReviewPage', { query: { error: new URL(preview.url, 'http://localhost').searchParams.get('error') } });
  assert.match(review.locals.formError, /Previous result card missing/);
  const save = await invoke('confirmImport');
  assert.match(decodeURIComponent(save.url), /Previous result card missing: Semester 1/);
  assert.equal(state.rolledBack, true);
  assert.equal(state.committed, false);
  assert.equal(state.results.length, 0);
  assert.equal(state.subjects.length, 0);
  assert.equal(state.students.length, 0);
  assert.equal(state.historyReads.at(-1).transaction, transaction);
});

test('a new student cannot be provisioned through a later-semester import', async () => {
  const { invoke, state } = fixture({ student: false });
  const save = await invoke('confirmImport');
  assert.match(decodeURIComponent(save.url), /not registered in MCA 2025/);
  assert.equal(state.students.length, 0);
  assert.equal(state.results.length, 0);
});

test('all prior academic semesters are required, not just the immediately previous semester', async () => {
  const { invoke } = fixture({ semester: 3, history: [card(2)] });
  assert.match((await invoke('validateReview')).locals.formError, /Semester 1/);
  const empty = fixture({ semester: 3 });
  assert.match((await empty.invoke('validateReview')).locals.formError, /Semesters 1, 2/);
});

test('saved failed original cards satisfy the prerequisite without requiring clearance', async () => {
  const { invoke, state } = fixture({ semester: 3, history: [card(1), card(2)] });
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  assert.equal((await invoke('showPreviewPage')).view, 'results/preview');
  assert.equal((await invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(state.committed, true);
  assert.equal(state.results.length, 1);
  assert.equal(state.subjects.length, 1);
});

test('Semester 1 original imports need no previous card', async () => {
  const { invoke, state } = fixture({ semester: 1 });
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  assert.equal((await invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(state.students.length, 0);
  assert.equal(state.historyReads.length, 0);
});

for (const [label, row] of [
  ['another student', card(1, { student_id: 8 })],
  ['another batch', card(1, { ResultSession: { ...card(1).ResultSession, batch_id: 2 } })],
  ['a future examination', card(1, { ResultSession: { ...card(1).ResultSession, exam_year: 2027 } })],
  ['an empty header', card(1, { SubjectResults: [] })],
  ['a backlog-only card', card(1, { exam_type: 'BACKLOG' })]
]) {
  test(`${label} does not substitute for the previous original card`, async () => {
    const { invoke } = fixture({ history: [row] });
    assert.equal((await invoke('validateReview')).statusCode, 422);
  });
}

for (const exam_type of ['BACKLOG', 'SUPPLEMENTARY', 'REPEAT']) {
  test(`${exam_type} requires an earlier original card for the same semester`, async () => {
    const { invoke, state } = fixture({ history: [card(1)], attempt: { attempt_no: 1, exam_type } });
    assert.match((await invoke('validateReview')).locals.formError, /Semester 2/);
    state.history.push(card(2));
    assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  });
}

test('later attempts within one session require a lower original attempt, not themselves', async () => {
  const { invoke, state, session } = fixture({ semester: 1, attempt: { attempt_no: 2, exam_type: 'REGULAR' } });
  state.history.push(card(1, { session_id: session.session_id, attempt_no: 2, ResultSession: session }));
  assert.equal((await invoke('validateReview')).statusCode, 422);
  state.history[0].attempt_no = 1;
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
});

test('final save rechecks history that was present at validation but subsequently removed', async () => {
  const { invoke, state } = fixture({ history: [card(1)] });
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  state.history = [];
  assert.match(decodeURIComponent((await invoke('confirmImport')).url), /Previous result card missing/);
  assert.equal(state.results.length, 0);
  assert.equal(state.rolledBack, true);
});

test('legacy creation cannot bypass the prior-card requirement', async () => {
  const { invoke, state, transaction } = fixture();
  const response = await invoke('create');
  assert.equal(response.statusCode, 422);
  assert.match(response.data.error, /Semester 1/);
  assert.equal(state.rolledBack, true);
  assert.equal(state.results.length, 0);
  assert.equal(state.historyReads[0].transaction, transaction);
});

test('legacy creation remains available when original history exists', async () => {
  const { invoke, state } = fixture({ history: [card(1)] });
  assert.equal((await invoke('create')).statusCode, 201);
  assert.equal(state.results.length, 1);
  assert.equal(state.committed, true);
});

test('duplicate result alert appears only after Validate, not after extraction', async () => {
  const { invoke, state, ocr } = fixture({ semester: 1, duplicate: true });
  const initial = await invoke('showReviewPage');
  assert.equal(initial.locals.duplicateStudent, false);
  assert.equal(initial.locals.formError, null);
  const initialHtml = await ejs.renderFile(path.join(root, 'views/results/review.ejs'), initial.locals);
  assert.doesNotMatch(initialHtml, /Duplicate Student Detected/);
  assert.doesNotMatch(initialHtml, /id="validateButton"[^>]*\sdisabled/);
  const validated = await invoke('validateReview');
  assert.equal(validated.statusCode, 422);
  assert.match(validated.locals.formError, /A result for USN 1MV25MC027 already exists/);
  assert.equal(ocr.validation_status, 'pending');
  const html = await ejs.renderFile(path.join(root, 'views/results/review.ejs'), validated.locals);
  assert.match(html, /<strong>Validation Failed<\/strong>/);
  assert.equal(state.results.length, 0);
  state.duplicate = false;
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
});

test('direct result preview and save still reject an existing session attempt', async () => {
  const { invoke, state } = fixture({ semester: 1, duplicate: true });
  assert.match(decodeURIComponent((await invoke('showPreviewPage')).url), /already exists/);
  assert.match(decodeURIComponent((await invoke('confirmImport')).url), /Duplicate blocked/);
  assert.equal(state.rolledBack, true);
  assert.equal(state.results.length, 0);
});

test('an existing different attempt does not create a false duplicate error', async () => {
  const { invoke } = fixture({ semester: 1, duplicate: true, history: [card(1)], attempt: { attempt_no: 2, exam_type: 'REGULAR' } });
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  assert.equal((await invoke('showPreviewPage')).view, 'results/preview');
});

for (let semester = 2; semester <= 24; semester++) {
  test(`Semester ${semester}: every earlier semester is enforced across validation, preview, save and legacy creation`, async () => {
    const complete = Array.from({ length: semester - 1 }, (_, index) => card(index + 1)).reverse();
    for (let missing = 1; missing < semester; missing++) {
      const { invoke, state } = fixture({ semester, history: complete.filter(row => Number(row.ResultSession.semester) !== missing) });
      const context = `Semester ${semester}, missing Semester ${missing}`;
      const expected = new RegExp('Previous result card missing: Semester ' + missing + ' for student');
      const validation = await invoke('validateReview');
      assert.equal(validation.statusCode, 422, context);
      assert.match(validation.locals.formError, expected, context);
      assert.match(decodeURIComponent((await invoke('showPreviewPage')).url), expected, context);
      assert.match(decodeURIComponent((await invoke('confirmImport')).url), expected, context);
      const legacy = await invoke('create');
      assert.equal(legacy.statusCode, 422, context);
      assert.match(legacy.data.error, expected, context);
      assert.equal(state.results.length, 0, context);
      assert.equal(state.subjects.length, 0, context);
      assert.equal(state.committed, false, context);
      assert.equal(state.rolledBack, true, context);
    }
    const allowed = fixture({ semester, history: complete });
    assert.equal((await allowed.invoke('validateReview')).url, '/results/upload/9/preview');
    assert.equal((await allowed.invoke('showPreviewPage')).view, 'results/preview');
    assert.equal((await allowed.invoke('confirmImport')).url, '/results/upload/9/success');
    assert.equal(allowed.state.committed, true);
    const legacy = fixture({ semester, history: complete });
    assert.equal((await legacy.invoke('create')).statusCode, 201);
  });

  test(`Semester ${semester}: retakes and later attempts also require that semester's original card`, async () => {
    for (const exam_type of ['BACKLOG', 'SUPPLEMENTARY', 'REPEAT', 'REGULAR']) {
      const history = Array.from({ length: semester - 1 }, (_, index) => card(index + 1));
      const { invoke, state } = fixture({ semester, history, attempt: { attempt_no: 2, exam_type } });
      const response = await invoke('validateReview');
      assert.equal(response.statusCode, 422, exam_type);
      assert.match(response.locals.formError, new RegExp('Previous result card missing: Semester ' + semester + ' for student'), exam_type);
      assert.match(decodeURIComponent((await invoke('confirmImport')).url), /Previous result card missing/, exam_type);
      assert.equal(state.results.length, 0, exam_type);
      state.history.push(card(semester));
      assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview', exam_type);
      assert.equal((await invoke('confirmImport')).url, '/results/upload/9/success', exam_type);
    }
  });
}

