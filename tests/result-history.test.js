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
    SubjectResults: [{ subject_result_id: semester, course_id_snapshot: 1, result_status: 'fail' }], ...extra };
}

for (const scenario of ['passed', 'never attempted', 'cleared by backlog', 'cleared by effective revaluation', 'foreign syllabus']) {
  test('BACKLOG rejects subject eligibility: ' + scenario + ' at validation, preview and final save', async () => {
    const history = [card(1)];
    if (scenario === 'passed') history[0].SubjectResults[0].result_status = 'pass';
    if (scenario === 'never attempted') history[0].SubjectResults[0].course_id_snapshot = 99;
    if (scenario === 'foreign syllabus') history[0].SubjectResults[0].course_id_snapshot = 2026;
    if (scenario === 'cleared by effective revaluation') history[0].SubjectResults[0].Revaluations = [
      { revaluation_no: 1, revaluation_status: 'approved', is_effective: true, revised_status: 'pass' }];
    if (scenario === 'cleared by backlog') history.push(card(1, { result_id: 10, session_id: 10, exam_type: 'BACKLOG', attempt_no: 2,
      SubjectResults: [{ subject_result_id: 10, course_id_snapshot: 1, result_status: 'pass' }] }));
    const f = fixture({ semester: 1, history, attempt: { exam_type: 'BACKLOG', attempt_no: history.length + 1 } });
    assert.equal((await f.invoke('validateReview')).statusCode, 422);
    assert.match(decodeURIComponent((await f.invoke('showPreviewPage')).url), /BACKLOG/);
    assert.match(decodeURIComponent((await f.invoke('confirmImport')).url), /BACKLOG/);
    assert.equal(f.state.results.length, 0);
  });
}
for (const value of ['50abc', '35.9', '1e3', '0x10', '-0.5', ' ', [], {}, null, -1, NaN, Infinity, 51]) {
  test('original marks reject malformed/over-limit value ' + JSON.stringify(value), async () => {
    const f = fixture({ semester: 1 });
    const result = await f.invoke('validateReview', { body: { usn: '1MV25MC027', name: 'TEST STUDENT', internal_1: value, external_1: '20' } });
    assert.equal(result.statusCode, 422); assert.equal(f.ocr.validation_status, 'pending'); assert.equal(f.state.results.length, 0);
  });
}
test('unresolved extracted row conflicts survive manipulated Validate and block final persistence', async () => {
  const f = fixture({ semester: 1 });
  f.ocr.extracted_json.integrity_conflicts = ['Multiple extracted rows identify C1. Upload a clear document.'];
  assert.equal((await f.invoke('validateReview')).statusCode, 422);
  assert.match(decodeURIComponent((await f.invoke('confirmImport')).url), /Multiple extracted rows/);
  assert.equal(f.state.results.length, 0);
});

function fixture({ semester = 2, sessionId = 20, history = [], student = true, duplicate = false, attempt = { attempt_no: 1, exam_type: 'REGULAR' } } = {}) {
  const state = { history, duplicate, updates: [], results: [], subjects: [], students: [], committed: false, rolledBack: false, historyReads: [] };
  const session = { session_id: sessionId, batch_id: 1, semester: String(semester), exam_session: 'Jul', exam_year: 2026, Batch: { batch_name: 'MCA 2025' } };
  const person = student ? { student_id: 7, batch_id: 1, usn: '1MV25MC027', student_name: 'TEST STUDENT' } : null;
  const definition = { subject_id: 1, course_id: 1, subject_type: 'theory', subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const log = { import_id: 9, file_name: 'test.pdf', file_type: 'pdf', ResultSession: session, update: async values => state.updates.push(values) };
  const ocr = { extracted_json: { student: { usn: '1MV25MC027', name: 'TEST STUDENT' }, attempt,
    document_context_verified: true, review_token: 'fixture-review',
    configuration_snapshot: require('../services/academicConfiguration').snapshot(session, [definition], [{ ...definition, semester: String(semester), is_required: true, roster_verified: true, status: 'active' }]),
    subjects: [{ subject_id: 1, internalMarks: 40, externalMarks: 40 }] }, validation_status: 'validated',
  async update(values) { state.updates.push(values); Object.assign(this, values); } };
  const transaction = { commit: async () => { state.committed = true; }, rollback: async () => { state.rolledBack = true; } };
  const db = {
    ImportLog: { findByPk: async () => log }, OcrExtraction: { findOne: async () => ocr },
    ResultSession: { findByPk: async (id, options) => { if (options?.lock) { assert.equal(options.transaction, transaction); state.sessionLocked = true; } return state.lockedSession || session; } }, Batch: { findByPk: async () => ({ batch_id: 1 }) },
    Student: { findOne: async () => person, findByPk: async () => person,
      create: async values => { state.students.push(values); return { student_id: 7, ...values }; } },
    Subject: { findAll: async () => [definition] },
    AcademicCourse: { findAll: async () => [{ ...definition, semester: String(semester), is_required: true, roster_verified: true, status: 'active' }] },
    SubjectResult: { bulkCreate: async values => { state.subjects.push(...values); } },
    Result: {
      findOne: async options => {
        assert.equal(options.where.student_id, 7);
        assert.equal(options.where.session_id, session.session_id);
        return state.duplicate && Number(options.where.attempt_no) === 1 ? { result_id: 99 } : null;
      },
      findAll: async options => {
        state.historyReads.push(options);
        assert.equal(options.where.student_id, 7);
        assert.equal(options.where.exam_type, undefined);
        assert.equal(options.include[0].required, true);
        assert.equal(options.include[0].where.batch_id, 1);
        assert.equal(options.include[1].required, false);
        return state.history.filter(row => row.student_id === options.where.student_id &&
          row.ResultSession.batch_id === options.include[0].where.batch_id);
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
  let reviewInitialized = false;
  async function invoke(method, overrides = {}) {
    if (!reviewInitialized) {
      ocr.extracted_json.configuration_snapshot = require('../services/academicConfiguration').snapshot(session, [definition], [{ ...definition, semester: String(semester), is_required: true, roster_verified: true, status: 'active' }]);
      reviewInitialized = true;
    }
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      render(view, locals) { this.view = view; this.locals = locals; }, redirect(url) { this.url = url; }, json(data) { this.data = data; } };
    await module.exports[method]({ params: { importId: '9' }, query: {},
      ...overrides, body: { usn: '1MV25MC027', name: 'TEST STUDENT', internal_1: '40', external_1: '40', student_id: 7, session_id: 20,
        verify_document_context: '1', review_token: ocr.extracted_json.review_token, ...overrides.body } }, response);
    return response;
  }
  return { state, session, ocr, transaction, invoke, db, definition };
}

for (const field of ['exam_session','exam_year','subject_name','roster']) {
  test('final confirmation rejects stale reviewed configuration: ' + field, async () => {
    const f = fixture({ semester: 1 });
    assert.equal((await f.invoke('validateReview')).url, '/results/upload/9/preview');
    if (field === 'exam_session') f.session.exam_session = 'Aug';
    else if (field === 'exam_year') f.session.exam_year = 2027;
    else if (field === 'subject_name') f.definition.subject_name = 'Corrected descriptive label';
    else f.db.AcademicCourse.findAll = async () => [{ ...f.definition, status: 'active', is_required: true, roster_verified: true },
      { ...f.definition, course_id: 2, subject_code: 'C2', status: 'active', is_required: false, roster_verified: true }];
    const response = await f.invoke('confirmImport');
    assert.match(decodeURIComponent(response.url), /older or unvalidated academic data/); assert.equal(f.state.results.length, 0);
  });
}
test('stale confirmation token and unvalidated staging cannot bypass final revalidation', async () => {
  const f = fixture({ semester: 1 }); await f.invoke('validateReview');
  assert.match(decodeURIComponent((await f.invoke('confirmImport', { body: { review_token: 'older-token', sgpa: 10, cgpa: 10 } })).url), /older or unvalidated/);
  f.ocr.validation_status = 'pending';
  assert.match(decodeURIComponent((await f.invoke('confirmImport')).url), /older or unvalidated/);
  assert.equal(f.state.results.length, 0);
});
for (const field of ['usn','semester','period']) {
  test('positive original document contradiction cannot be manually confirmed away: ' + field, async () => {
    const f = fixture({ semester: 1 });
    f.ocr.extracted_json.document_evidence = field === 'usn' ? { usns: ['OTHER001'] }
      : field === 'semester' ? { semesters: [2] } : { periods: [{ exam_session: 'Dec', exam_year: 2025 }] };
    const res = await f.invoke('validateReview', { body: { verify_document_context: '1', verify_mixed_context: '1' } });
    assert.equal(res.statusCode, 422); assert.match(res.locals.formError, /does not match/); assert.equal(f.state.results.length, 0);
  });
}
test('explicit mixed-document scope keeps exclusions and allows only the selected eligible semester', async () => {
  const f = fixture({ semester: 1, history: [card(1)], attempt: { exam_type: 'BACKLOG', attempt_no: 2 } });
  f.ocr.extracted_json.document_evidence = { semesters: [2], types: ['REGULAR'], usns: ['1MV25MC027'] };
  f.ocr.extracted_json.excluded_subjects = [{ subject_code: 'C201', subject_name: 'Semester 2 course' }];
  f.db.AcademicCourse.findAll = async options => [{ ...f.definition, semester: '1', status: 'active', is_required: true, roster_verified: true },
    ...(!options.where.semester ? [{ ...f.definition, course_id: 201, subject_code: 'C201', semester: '2', status: 'active' }] : [])];
  assert.equal((await f.invoke('validateReview')).statusCode, 422);
  assert.equal((await f.invoke('validateReview', { body: { verify_mixed_context: '1' } })).url, '/results/upload/9/preview');
  assert.equal((await f.invoke('confirmImport')).url, '/results/upload/9/success');
  assert.deepEqual(f.state.subjects.map(row => row.subject_id), [1]);
  assert.equal(f.state.results[0].sgpa, null);
});
test('old student backlog uses old batch course even when next batch reuses its code for a different syllabus', async () => {
  const f = fixture({ semester: 1, history: [card(1)], attempt: { exam_type: 'BACKLOG', attempt_no: 2 } });
  const courses = [{ ...f.definition, batch_id: 1, semester: '1', status: 'active', is_required: true, roster_verified: true },
    { ...f.definition, batch_id: 2, course_id: 2026, subject_name: 'Different new syllabus course', credits: 3, semester: '1', status: 'active', is_required: true, roster_verified: true }];
  f.db.AcademicCourse.findAll = async options => courses.filter(course => String(course.batch_id) === String(options.where.batch_id));
  assert.equal((await f.invoke('validateReview')).url, '/results/upload/9/preview');
  assert.equal((await f.invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(f.state.subjects[0].course_id_snapshot, 1); assert.notEqual(f.state.subjects[0].course_id_snapshot, 2026);
});
test('a review changed after initial confirmation load is rejected by the transactional OCR re-read', async () => {
  const f = fixture({ semester: 1 }); await f.invoke('validateReview');
  f.db.Batch.findByPk = async () => {
    f.ocr.extracted_json = { ...f.ocr.extracted_json, review_token: 'a-newer-review-token' };
    return { batch_id: 1 };
  };
  const response = await f.invoke('confirmImport');
  assert.match(decodeURIComponent(response.url), /reviewed document or decisions changed/); assert.equal(f.state.results.length, 0);
});

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
  assert.equal(state.historyReads.length, 2, 'History is checked for a duplicate semester REGULAR result');
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

for (const exam_type of ['BACKLOG']) {
  test(`${exam_type} requires an earlier original card for the same semester`, async () => {
    const { invoke, state } = fixture({ history: [card(1)], attempt: { attempt_no: 2, exam_type } });
    assert.match((await invoke('validateReview')).locals.formError, /Semester 2/);
    state.history.push(card(2));
    assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  });
}

for (const exam_type of ['SUPPLEMENTARY', 'REPEAT']) {
  test(`legacy ${exam_type} drafts cannot validate, preview, or import a new result`, async () => {
    const { invoke, state } = fixture({ semester: 1, history: [card(1)], attempt: { attempt_no: 2, exam_type } });
    const review = await invoke('validateReview');
    assert.equal(review.statusCode, 422);
    assert.match(String(review.locals.formError), /REGULAR, BACKLOG/);
    assert.match((await invoke('showPreviewPage')).url, /\/review/);
    assert.match((await invoke('confirmImport')).url, /\/review/);
    assert.equal(state.results.length, 0);
    assert.equal(state.subjects.length, 0);
    assert.equal(state.committed, false);
  });
}

for (const attempt_no of [2, 3, 25]) {
  test(`BACKLOG attempt ${attempt_no} keeps its identity and does not rewrite the original result`, async () => {
    const original = card(1, { sgpa: 4.5, cgpa: 4.5 });
    const before = JSON.stringify(original);
    const earlier = Array.from({ length: attempt_no - 2 }, (_, index) => card(1, { result_id: index + 10, session_id: index + 10, attempt_no: index + 2, exam_type: 'BACKLOG' }));
    const { invoke, state } = fixture({ semester: 1, history: [original, ...earlier], attempt: { attempt_no, exam_type: 'BACKLOG' } });
    assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
    assert.equal((await invoke('confirmImport')).url, '/results/upload/9/success');
    assert.equal(state.results.length, 1);
    assert.equal(state.results[0].attempt_no, attempt_no);
    assert.equal(state.results[0].exam_type, 'BACKLOG');
    assert.equal(state.results[0].sgpa, null);
    assert.equal(JSON.stringify(original), before);
    assert.equal(state.subjects[0].result_id, 100);
  });
}

test('Backlog numbering continues across sessions and rejects reused or skipped numbers', async () => {
  const second = card(1, { result_id: 10, session_id: 10, exam_type: 'BACKLOG', attempt_no: 2,
    ResultSession: { ...card(1).ResultSession, session_id: 10, exam_session: 'Mar' } });
  for (const attempt_no of [2, 4]) {
    const { invoke, state } = fixture({ semester: 1, history: [card(1), second], attempt: { attempt_no, exam_type: 'BACKLOG' } });
    assert.match(String((await invoke('validateReview')).locals.formError), /must use attempt 3/);
    assert.match(decodeURIComponent((await invoke('confirmImport')).url), /must use attempt 3/);
    assert.equal(state.results.length, 0);
  }
  const allowed = fixture({ semester: 1, history: [card(1), second], attempt: { attempt_no: 3, exam_type: 'BACKLOG' } });
  assert.equal((await allowed.invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(allowed.state.results[0].attempt_no, 3);
  assert.equal(allowed.state.historyReads.at(-1).lock, true, 'Final numbering reads current locked history');
});

test('another session cannot create another Regular result for the same semester', async () => {
  const { invoke, state } = fixture({ semester: 1, history: [card(1)] });
  assert.match(String((await invoke('validateReview')).locals.formError), /REGULAR result.*already exists/);
  assert.match(decodeURIComponent((await invoke('showPreviewPage')).url), /REGULAR result.*already exists/);
  assert.match(decodeURIComponent((await invoke('confirmImport')).url), /REGULAR result.*already exists/);
  assert.equal(state.results.length, 0);
});

test('a concurrently saved backlog is rechecked before final confirmation', async () => {
  const { invoke, state } = fixture({ semester: 1, history: [card(1)], attempt: { attempt_no: 2, exam_type: 'BACKLOG' } });
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  state.history.push(card(1, { result_id: 10, session_id: 10, attempt_no: 2, exam_type: 'BACKLOG' }));
  assert.match(decodeURIComponent((await invoke('confirmImport')).url), /must use attempt 3/);
  assert.equal(state.results.length, 0);
  assert.equal(state.rolledBack, true);
});

test('legacy session-scoped numbers remain unchanged while new Backlog continues after historical sittings', async () => {
  const history = [card(1), card(1, { result_id: 10, session_id: 10, attempt_no: 1, exam_type: 'SUPPLEMENTARY' }),
    card(1, { result_id: 11, session_id: 11, attempt_no: 1, exam_type: 'REPEAT' })];
  const before = JSON.stringify(history);
  const { invoke, state } = fixture({ semester: 1, history, attempt: { attempt_no: 4, exam_type: 'BACKLOG' } });
  assert.equal((await invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(state.results[0].attempt_no, 4);
  assert.equal(JSON.stringify(history), before);
});

for (const exam_type of ['SUPPLEMENTARY', 'REPEAT']) {
  test(`Review preserves a legacy ${exam_type} draft label rather than displaying Regular`, async () => {
    const { invoke } = fixture({ semester: 1, attempt: { attempt_no: 2, exam_type } });
    const response = await invoke('showReviewPage');
    assert.equal(response.locals.attempt.exam_type, exam_type);
    assert.match(response.locals.formError, /REGULAR, BACKLOG/);
  });
}

test('later attempts cannot reuse the original examination period even with a lower original attempt', async () => {
  const { invoke, state, session } = fixture({ semester: 1, attempt: { attempt_no: 2, exam_type: 'BACKLOG' } });
  state.history.push(card(1, { session_id: session.session_id, attempt_no: 2, ResultSession: session }));
  assert.equal((await invoke('validateReview')).statusCode, 422);
  state.history[0].attempt_no = 1;
  assert.match(String((await invoke('validateReview')).locals.formError), /new examination period/);
});

for (const sameId of [true, false]) for (const month of ['Dec', ' December ', 'DEC']) {
  test(`same-period backlog is rejected on Validate, Preview and Save (same ID ${sameId}, month ${month})`, async () => {
    const original = card(1, { session_id: sameId ? 20 : 1, sgpa: 4.5, cgpa: 4.5,
      ResultSession: { session_id: sameId ? 20 : 1, batch_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025 } });
    const before = JSON.stringify(original);
    const { invoke, state, session } = fixture({ semester: 1, history: [original], attempt: { attempt_no: 2, exam_type: 'BACKLOG' } });
    Object.assign(session, { exam_session: month, exam_year: 2025 });
    assert.match(String((await invoke('validateReview')).locals.formError), /new examination period/);
    assert.match(decodeURIComponent((await invoke('showPreviewPage')).url), /new examination period/);
    assert.match(decodeURIComponent((await invoke('confirmImport')).url), /new examination period/);
    assert.equal(state.results.length, 0); assert.equal(state.subjects.length, 0);
    assert.equal(state.rolledBack, true); assert.equal(JSON.stringify(original), before);
  });
}

test('Dec Regular, June Backlog and June next-semester Regular coexist; later Backlog keeps its own semester sequence', async () => {
  const first = fixture({ semester: 1, sessionId: 1 });
  Object.assign(first.ocr.extracted_json.subjects[0], { internalMarks: 10, externalMarks: 10 });
  Object.assign(first.session, { exam_session: 'Dec', exam_year: 2025 });
  assert.equal((await first.invoke('confirmImport')).url, '/results/upload/9/success');
  const original = { ...first.state.results[0], result_id: 1, ResultSession: { ...first.session }, SubjectResults: [...first.state.subjects] };
  const before = JSON.stringify(original);
  const second = fixture({ semester: 1, sessionId: 2, history: [original], attempt: { attempt_no: 2, exam_type: 'BACKLOG' } });
  Object.assign(second.ocr.extracted_json.subjects[0], { internalMarks: 10, externalMarks: 10 });
  second.session.exam_session = 'June';
  assert.equal((await second.invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(second.state.results[0].sgpa, null); assert.equal(second.state.results[0].session_id, 2);
  const backlog = { ...second.state.results[0], result_id: 2, ResultSession: { ...second.session }, SubjectResults: [...second.state.subjects] };
  const current = fixture({ semester: 2, sessionId: 3, history: [original, backlog] });
  current.session.exam_session = 'Jun';
  assert.equal((await current.invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(current.state.results[0].attempt_no, 1); assert.notEqual(current.state.results[0].sgpa, null);
  const next = fixture({ semester: 1, sessionId: 4, history: [original, backlog], attempt: { attempt_no: 3, exam_type: 'BACKLOG' } });
  next.session.exam_session = 'Dec';
  assert.equal((await next.invoke('confirmImport')).url, '/results/upload/9/success');
  assert.equal(next.state.results[0].attempt_no, 3); assert.equal(next.state.sessionLocked, true);
  assert.equal(JSON.stringify(original), before);
  const skipped = fixture({ semester: 1, history: [original], attempt: { attempt_no: 3, exam_type: 'BACKLOG' } });
  assert.match(decodeURIComponent((await skipped.invoke('confirmImport')).url), /must use attempt 2/);
  const reusedPeriod = fixture({ semester: 1, history: [original, backlog], attempt: { attempt_no: 3, exam_type: 'BACKLOG' } });
  reusedPeriod.session.exam_session = 'Jun';
  assert.match(decodeURIComponent((await reusedPeriod.invoke('confirmImport')).url), /new examination period/);
});

test('an identity edit while opening an import is detected before academic writes', async () => {
  const { invoke, state, session } = fixture({ semester: 1 });
  state.lockedSession = { ...session, exam_year: 2027 };
  assert.match(decodeURIComponent((await invoke('confirmImport')).url), /examination session changed/);
  assert.equal(state.results.length, 0); assert.equal(state.subjects.length, 0); assert.equal(state.rolledBack, true);
});

test('excluded mixed-card subjects remain visible through Review, failed validation, successful validation and Preview', async () => {
  const { invoke, ocr } = fixture({ semester: 1 });
  ocr.extracted_json.excluded_subjects = [{ subject_code: 'MMC201<script>', subject_name: 'Another semester' }];
  const initial = await invoke('showReviewPage');
  const failed = await invoke('validateReview', { body: { usn: '1MV25MC027', name: 'TEST STUDENT', internal_1: -1, external_1: 40 } });
  assert.equal(failed.statusCode, 422);
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  const preview = await invoke('showPreviewPage');
  for (const response of [initial, failed, preview]) {
    assert.equal(response.locals.excludedSubjects[0].subject_code, 'MMC201<script>');
    const html = await ejs.renderFile(path.join(root, 'views', response.view + '.ejs'), response.locals);
    assert.match(html, /Extracted subjects excluded from this upload/);
    assert.match(html, /MMC201&lt;script&gt;/); assert.doesNotMatch(html, /MMC201<script>/);
    assert.match(html, /will not be imported/);
  }
  assert.equal(ocr.extracted_json.excluded_subjects.length, 1);
});

test('a forged out-of-session subject from a mixed card cannot be added during Review validation', async () => {
  const { invoke, state } = fixture({ semester: 2, history: [card(1)] });
  const response = await invoke('validateReview', { body: { usn: '1MV25MC027', name: 'TEST STUDENT',
    internal_1: 40, external_1: 40, internal_999: 30, external_999: 28 } });
  assert.equal(response.statusCode, 422);
  assert.match(String(response.locals.formError), /does not belong to this examination session/);
  assert.equal(state.results.length, 0); assert.equal(state.subjects.length, 0);
});

test('final save rechecks history that was present at validation but subsequently removed', async () => {
  const { invoke, state } = fixture({ history: [card(1)] });
  assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
  state.history = [];
  assert.match(decodeURIComponent((await invoke('confirmImport')).url), /Previous result card missing/);
  assert.equal(state.results.length, 0);
  assert.equal(state.rolledBack, true);
});

test('legacy creation is retired even when a prior card is missing', async () => {
  const { invoke, state, transaction } = fixture();
  const response = await invoke('create');
  assert.equal(response.statusCode, 403);
  assert.match(response.data.error, /Generic result creation is disabled/);
  assert.equal(state.rolledBack, false);
  assert.equal(state.results.length, 0);
  assert.equal(state.historyReads.length, 0);
});

test('legacy creation remains blocked when original history exists', async () => {
  const { invoke, state } = fixture({ history: [card(1)] });
  assert.equal((await invoke('create')).statusCode, 403);
  assert.equal(state.results.length, 0);
  assert.equal(state.committed, false);
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
  const { invoke } = fixture({ semester: 1, duplicate: true, history: [card(1)], attempt: { attempt_no: 2, exam_type: 'BACKLOG' } });
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
      assert.equal(legacy.statusCode, 403, context);
      assert.match(legacy.data.error, /Generic result creation is disabled/, context);
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
    assert.equal((await legacy.invoke('create')).statusCode, 403);
  });

  test(`Semester ${semester}: retakes and later attempts also require that semester's original card`, async () => {
    for (const exam_type of ['BACKLOG']) {
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

