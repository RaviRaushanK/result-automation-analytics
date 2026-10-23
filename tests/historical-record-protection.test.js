'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const policy = require('../services/academicPolicy');
const root = path.resolve(__dirname, '..');

// Controllers/routes run unchanged, but every persistence dependency is isolated.
function load(file, overrides = {}) {
  const full = path.join(root, file), localRequire = createRequire(full), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(full, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(full), console, process, URLSearchParams, setTimeout,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name)
  }, { filename: full });
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(hasHistory = true) {
  const original = { student_id: 7, student_uuid: 'original-student', batch_id: 1, usn: 'AUDIT001',
    student_name: 'AUDIT STUDENT', email: 'audit.student@gmail.com', category: 'PGCET', status: 'active' };
  const state = { student: { ...original }, results: hasHistory ? [{ result_id: 10, student_id: 7, session_id: 20,
    attempt_no: 1, exam_type: 'REGULAR', sgpa: 0, cgpa: 0, result_status: 'fail', failed_subject_count: 1 }] : [],
    subjects: hasHistory ? [{ subject_result_id: 11, result_id: 10, subject_id: 1, marks: 40, grade: 'F', result_status: 'fail' }] : [],
    revaluations: hasHistory ? [{ revaluation_id: 12, subject_result_id: 11, revised_marks: 60, is_effective: true }] : [],
    events: [], forbiddenWrites: 0 };
  let lockTail = Promise.resolve();
  const models = {
    ResultSession: {}, ImportLog: {}, OcrExtraction: {}, Subject: {}, AcademicCourse: {},
    sequelize: { async transaction(callback) {
      const transaction = { LOCK: { UPDATE: 'UPDATE' }, release: null,
        async commit() { state.events.push('commit'); this.release?.(); this.release = null; },
        async rollback() { state.events.push('rollback'); this.release?.(); this.release = null; } };
      state.events.push('begin');
      if (!callback) return transaction;
      try { const value = await callback(transaction); await transaction.commit(); return value; }
      catch (error) { await transaction.rollback(); throw error; }
    } },
    Batch: { findByPk: async id => ({ batch_id: Number(id), batch_name: 'Audit ' + id }) },
    Student: {
      async findByPk(id, options = {}) {
        if (options.lock) await acquire(options.transaction);
        return String(id) === '7' ? record : null;
      },
      async findOne(options) {
        if (options.paranoid === false) return null; // No competing USN/email in this isolated directory.
        if (options.lock) await acquire(options.transaction);
        return options.where.usn === state.student.usn ? record : null;
      }
    },
    Result: {
      async findOne(options) {
        if (options.lock) {
          assert.equal(options.transaction.LOCK.UPDATE, options.lock);
          assert.ok(options.transaction.release, 'Student row must be locked before checking history');
          state.events.push('history-current-read');
          if (state.beforeHistoryRead) await state.beforeHistoryRead();
        }
        return state.results.find(row => Object.entries(options.where).every(([key, value]) => String(row[key]) === String(value))) || null;
      },
      findAll: async () => state.results.map(row => ({ ...row, ResultSession: {
        session_id: row.session_id, batch_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025
      } })),
      findByPk: async id => state.results.find(row => String(row.result_id) === String(id)),
      async update() { state.forbiddenWrites++; throw new Error('Generic update must not reach persistence'); },
      async destroy() { state.forbiddenWrites++; state.results = []; state.subjects = []; state.revaluations = []; }
    },
    SubjectResult: { update: async () => assert.fail('Original subject update forbidden'), destroy: async () => assert.fail('Original subject deletion forbidden') }
  };
  async function acquire(transaction) {
    if (transaction.release) return;
    const previous = lockTail, gate = deferred();
    lockTail = gate.promise;
    state.events.push('student-lock-request');
    await previous;
    transaction.release = gate.resolve;
    state.events.push('student-lock-acquired');
    if (state.afterStudentLock) await state.afterStudentLock();
  }
  const record = { ...original, async update(values, options) {
    assert.ok(options.transaction.release, 'Student update must retain the row lock');
    Object.assign(state.student, values); Object.assign(record, values); state.events.push('student-update');
  }, toJSON: () => state.student };
  const student = load('controllers/studentController.js', { '../database/models': models, '../services/studentDirectoryService': {} });
  const history = load('services/resultHistoryService.js', { '../database/models': models });
  const result = load('controllers/resultController.js', {
    '../database/models': models, '../services/documentExtractor': {}, '../services/resultHistoryService': history,
    '../services/academicOutcomeService': { calculateCumulative: async () => null }
  });
  return { models, state, student, result, original };
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, redirect(url) { this.url = url; } };
}

async function http(t, f) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { adminId: 1 }; req.user = { role: 'admin' }; next(); });
  app.use('/students', load('routes/studentRoutes.js', { '../controllers/studentController': f.student }));
  app.use('/results', load('routes/resultRoutes.js', { '../controllers/resultController': f.result }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return async (method, url, body) => {
    const res = await fetch('http://127.0.0.1:' + server.address().port + url,
      { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
}

for (const field of ['usn', 'batch_id']) {
  const change = field === 'usn' ? 'AUDIT099' : 2;
  test('direct HTTP rejects historical student ' + field + ' change without modifying any academic rows', async t => {
    const f = fixture(), request = await http(t, f), before = JSON.stringify(f.state);
    const res = await request('PUT', '/students/api/7', { ...f.original, [field]: change, has_academic_history: false });
    assert.equal(res.status, 409);
    assert.match(res.body.message, field === 'usn' ? /USN cannot be changed.*academic result history/ : /Batch cannot be changed.*academic result history/);
    const old = JSON.parse(before);
    for (const key of ['student', 'results', 'subjects', 'revaluations']) assert.deepEqual(f.state[key], old[key]);
    assert.ok(f.state.events.includes('history-current-read'));
    assert.equal(f.state.events.at(-1), 'rollback');
  });
  test('direct HTTP preserves legitimate no-history student ' + field + ' edit', async t => {
    const f = fixture(false), request = await http(t, f);
    const res = await request('PUT', '/students/api/7', { ...f.original, [field]: change });
    assert.equal(res.status, 200); assert.equal(f.state.student[field], change);
    assert.equal(f.state.events.at(-1), 'commit');
  });
}

test('historical student name/email/category/status edits and normalized identical USN/batch remain allowed', async t => {
  const f = fixture(), request = await http(t, f), before = JSON.stringify([f.state.results, f.state.subjects, f.state.revaluations]);
  const res = await request('PUT', '/students/api/7', { ...f.original, usn: ' audit001 ', batch_id: '1',
    student_name: 'Updated Name', email: 'updated.student@gmail.com', category: 'MGT', status: 'inactive',
    student_id: 999, student_uuid: 'forged' });
  assert.equal(res.status, 200);
  assert.equal(f.state.student.student_name, 'UPDATED NAME'); assert.equal(f.state.student.email, 'updated.student@gmail.com');
  assert.equal(f.state.student.category, 'MGT'); assert.equal(f.state.student.status, 'inactive');
  assert.equal(f.state.student.usn, 'AUDIT001'); assert.equal(f.state.student.batch_id, 1);
  assert.equal(f.state.student.student_id, 7); assert.equal(f.state.student.student_uuid, 'original-student');
  assert.equal(JSON.stringify([f.state.results, f.state.subjects, f.state.revaluations]), before);
});

test('combined USN and batch change explains both immutable fields; unknown student stays 404', async t => {
  const f = fixture(), request = await http(t, f);
  const res = await request('PUT', '/students/api/7', { ...f.original, usn: 'AUDIT099', batch_id: 2 });
  assert.equal(res.status, 409); assert.match(res.body.message, /USN cannot/); assert.match(res.body.message, /Batch cannot/);
  assert.equal((await request('PUT', '/students/api/999', f.original)).status, 404);
});

test('student GET exposes server-owned history flag for the edit form', async t => {
  for (const hasHistory of [true, false]) {
    const request = await http(t, fixture(hasHistory));
    const res = await request('GET', '/students/api/7');
    assert.equal(res.status, 200); assert.equal(res.body.has_academic_history, hasHistory);
  }
});

for (const field of ['sgpa', 'cgpa', 'result_status', 'failed_subject_count', 'attempt_no', 'exam_type', 'student_id', 'session_id']) {
  test('legacy HTTP PUT rejects ' + field + ' changes and preserves original rows', async t => {
    const f = fixture(), request = await http(t, f), before = JSON.stringify(f.state);
    const values = { sgpa: 9.99, cgpa: 9.99, result_status: 'pass', failed_subject_count: 0,
      attempt_no: 2, exam_type: 'BACKLOG', student_id: 999, session_id: 21 };
    const res = await request('PUT', '/results/10', { [field]: values[field] });
    assert.equal(res.status, 403); assert.match(res.body.error, /cannot be directly edited.*controlled academic workflow/);
    assert.equal(JSON.stringify(f.state), before);
  });
}

test('legacy HTTP DELETE cannot cascade and POST method/route manipulation cannot delete saved history', async t => {
  const f = fixture(), request = await http(t, f), before = JSON.stringify(f.state);
  const res = await request('DELETE', '/results/10');
  assert.equal(res.status, 403); assert.match(res.body.error, /cannot be deleted.*permanent academic history/);
  for (const url of ['/results/10', '/results/10/delete', '/results/10?_method=DELETE']) {
    assert.equal((await request('POST', url, { _method: 'DELETE' })).status, 404);
  }
  assert.equal(JSON.stringify(f.state), before);
  assert.equal(f.state.subjects.length, 1); assert.equal(f.state.revaluations.length, 1); assert.equal(f.state.forbiddenWrites, 0);
});

test('legacy result reads remain available and controllers reject direct mutation calls too', async t => {
  const f = fixture(), request = await http(t, f);
  assert.equal((await request('GET', '/results/10')).body.result_id, 10);
  assert.equal((await request('GET', '/results/student/7')).body.length, 1);
  for (const action of ['update', 'delete']) {
    const res = response(); await f.result[action]({ params: { id: 10 }, body: { sgpa: 9.99 } }, res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(f.state.forbiddenWrites, 0);
});

function addImport(f) {
  const session = { session_id: 20, batch_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025, Batch: { batch_name: 'Audit batch' } };
  const saved = { student: { usn: 'AUDIT001', name: 'AUDIT STUDENT' }, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    subjects: [{ subject_id: 1, internalMarks: 20, externalMarks: 20 }] };
  const subject = { subject_id: 1, course_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4,
    max_internal: 50, max_external: 50, max_marks: 100 };
  const definitions = {
    ResultSession: { findByPk: async () => session },
    ImportLog: { findByPk: async () => ({ import_id: 9, ResultSession: session, update: async () => {} }) },
    OcrExtraction: { findOne: async () => ({ extracted_json: saved, validation_status: 'validated' }) },
    Subject: { findAll: async () => [subject] },
    AcademicCourse: { findAll: async () => [{ ...subject, is_required: true, roster_verified: true }] }
  };
  saved.configuration_snapshot = require('../services/academicConfiguration').snapshot(session, [subject], [{ ...subject, is_required: true, roster_verified: true }]);
  saved.document_context_verified = { usn: true, semester: true, period: true }; saved.review_token = 'fixture-review';
  for (const [name, methods] of Object.entries(definitions)) Object.assign(f.models[name], methods);
  f.models.Result.create = async (values, options) => {
    assert.ok(options.transaction.release, 'Import must own the shared Student lock');
    const row = { ...values, result_id: 10 }; f.state.results.push(row); return row;
  };
  f.models.SubjectResult.bulkCreate = async rows => { f.state.subjects.push(...rows); };
  return { saved, session, subject };
}

test('direct HTTP generic Result POST is retired without creating incomplete history', async t => {
  const f = fixture(false), request = await http(t, f);
  const res = await request('POST', '/results', { student_id: 7, session_id: 20, sgpa: 10, result_status: 'pass' });
  assert.equal(res.status, 403); assert.match(res.body.error, /Generic result creation is disabled/); assert.equal(f.state.results.length, 0);
});
test('two simultaneous ordinary confirmations cannot create duplicate original history', async () => {
  const f = fixture(false); addImport(f);
  const one = response(), two = response();
  await Promise.all([f.result.confirmImport({ params: { importId: 9 }, body: { review_token: 'fixture-review' } }, one),
    f.result.confirmImport({ params: { importId: 9 }, body: { review_token: 'fixture-review' } }, two)]);
  assert.equal(f.state.results.length, 1); assert.equal(f.state.subjects.length, 1);
  assert.ok([one.url, two.url].some(url => /success/.test(url)));
});
test('two simultaneous Backlog Attempt 2 confirmations preserve one retake and its original Regular history', async () => {
  const f = fixture(true), { saved, session, subject } = addImport(f);
  f.state.results[0].session_id = 1; f.state.subjects[0].course_id_snapshot = 1;
  session.exam_session = 'Jun'; session.exam_year = 2026;
  saved.attempt = { attempt_no: 2, exam_type: 'BACKLOG' };
  saved.configuration_snapshot = require('../services/academicConfiguration').snapshot(session, [subject], [{ ...subject, is_required: true, roster_verified: true }]);
  f.models.Result.findAll = async () => f.state.results.map(row => ({ ...row,
    ResultSession: row.session_id === 1 ? { batch_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025 } : session,
    SubjectResults: f.state.subjects.filter(sr => sr.result_id === row.result_id) }));
  const before = JSON.stringify(f.state.results[0]), one = response(), two = response();
  await Promise.all([f.result.confirmImport({ params: { importId: 9 }, body: { review_token: 'fixture-review', sgpa: 10 } }, one),
    f.result.confirmImport({ params: { importId: 9 }, body: { review_token: 'fixture-review', sgpa: 10 } }, two)]);
  const retakes = f.state.results.filter(row => row.exam_type === 'BACKLOG');
  assert.equal(retakes.length, 1); assert.equal(retakes[0].sgpa, null); assert.equal(retakes[0].attempt_no, 2);
  assert.equal(JSON.stringify(f.state.results[0]), before); assert.ok([one.url, two.url].some(url => /success/.test(url)));
});

for (const field of ['usn', 'batch_id']) {
  test('isolated import-first interleaving rejects waiting student ' + field + ' edit', { timeout: 5000 }, async () => {
    const f = fixture(false); addImport(f);
    const locked = deferred(), continueImport = deferred();
    let first = true;
    f.state.afterStudentLock = async () => { if (first) { first = false; locked.resolve(); await continueImport.promise; } };
    const imported = response(), edited = response();
    const importing = f.result.confirmImport({ params: { importId: 9 }, body: { review_token: 'fixture-review' } }, imported);
    await locked.promise;
    const editing = f.student.update({ params: { id: 7 }, body: { ...f.original, [field]: field === 'usn' ? 'AUDIT099' : 2 } }, edited);
    continueImport.resolve();
    await Promise.all([importing, editing]);
    assert.match(imported.url, /success$/); assert.equal(edited.statusCode, 409);
    assert.equal(f.state.results.length, 1); assert.equal(f.state.subjects.length, 1);
    assert.equal(f.state.student.usn, 'AUDIT001'); assert.equal(f.state.student.batch_id, 1);
  });
  test('isolated edit-first interleaving invalidates stale import for changed ' + field, { timeout: 5000 }, async () => {
    const f = fixture(false); addImport(f);
    const checked = deferred(), continueEdit = deferred();
    f.state.beforeHistoryRead = async () => { checked.resolve(); await continueEdit.promise; };
    const edited = response(), imported = response();
    const editing = f.student.update({ params: { id: 7 }, body: { ...f.original, [field]: field === 'usn' ? 'AUDIT099' : 2 } }, edited);
    await checked.promise;
    const importing = f.result.confirmImport({ params: { importId: 9 }, body: { review_token: 'fixture-review' } }, imported);
    continueEdit.resolve();
    await Promise.all([editing, importing]);
    assert.equal(edited.statusCode, 200); assert.match(imported.url, /review/);
    assert.equal(f.state.results.length, 0); assert.equal(f.state.subjects.length, 0);
  });
}

test('controlled revaluation approval creates separate event while preserving original Result/SubjectResult', async () => {
  const subject = { subject_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const sr = { subject_result_id: 11, result_id: 10, subject_id: 1, marks: 40, grade: 'F', result_status: 'fail', Subject: subject };
  const result = { result_id: 10, student_id: 7, session_id: 20, attempt_no: 1, exam_type: 'REGULAR', sgpa: 0, cgpa: 0,
    Student: { student_name: 'AUDIT STUDENT', usn: 'AUDIT001' }, ResultSession: { semester: '1' }, SubjectResults: [sr] };
  const before = JSON.stringify(result), events = [];
  const saved = { result_id: 10, student_id: 7, session_id: 20, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    documents: [{ file_name: 'isolated-card.pdf' }], ocr: { extraction_status: 'extracted',
      student_candidates: { name: 'AUDIT STUDENT', usn: 'AUDIT001' }, subjects: [] },
    review: { submitted_by: 1, baselines: { 11: { marks: 40, status: 'fail' } },
      proposal: [{ subject_result_id: 11, decision: 'accept', proposed_revised_internal_marks: 40,
        proposed_revised_external_marks: 40, proposed_revised_total_marks: 80 }] } };
  const ocr = { validation_status: 'validated', extracted_json: saved, set(key, value) { this[key] = value; }, save: async () => {} };
  const log = { import_id: 9, import_type: 'REVALUATION', status: 'extracted', OcrExtractions: [ocr], update: async () => {} };
  const transaction = { LOCK: { UPDATE: 'UPDATE' }, commit: async () => {}, rollback: async () => assert.fail('Approval should commit') };
  const models = { Result: { findByPk: async () => result }, SubjectResult: { findAll: async () => [sr] },
    ImportLog: { findByPk: async () => log }, AdminUser: { findByPk: async () => ({ admin_id: 1, role: 'admin', status: 'active' }) },
    RevaluationResult: { findAll: async () => [], count: async () => 0, update: async () => {},
      create: async data => { const row = { ...data, revaluation_id: 12, save: async () => {} }; events.push(row); return row; },
      findByPk: async () => events[0] }, sequelize: { transaction: async () => transaction, query: async () => [[{ next_no: 1 }]] } };
  const controller = load('controllers/revaluationController.js', { '../database/models': models, '../middlewares/upload': {},
    './resultController': { _test: { gradeFromPercent: policy.gradeFromPercent } } });
  const integrity = require('../services/revaluationIntegrity');
  saved.review.target_snapshot = integrity.snapshot(result); saved.review.identity_verified = { usn: true, semester: true, period: true, old_marks: true, old_status: true };
  const res = response(); await controller.approveReview({ params: { importId: 9 }, session: { adminId: 1 }, body: { review_token: integrity.digest(saved.review) } }, res);
  assert.equal(res.url, '/revaluation/outcome/9'); assert.equal(events.length, 1);
  assert.equal(events[0].subject_result_id, 11); assert.equal(events[0].revised_marks, 80);
  assert.equal(events[0].revaluation_status, 'approved'); assert.equal(events[0].is_effective, true);
  assert.equal(JSON.stringify(result), before);
});
