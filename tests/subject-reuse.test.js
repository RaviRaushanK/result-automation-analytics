'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const ejs = require('ejs');
const fields = ['subject_code','subject_name','subject_type','credits','max_internal','max_external','max_marks'];
const copy = value => JSON.parse(JSON.stringify(value));
function load(file, replacements) {
  const filename = require.resolve(file), module = { exports: {} }, local = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console: { error() {} },
    require: name => replacements[name] || local(name) }, { filename });
  return module.exports;
}
function fixture() {
  const course = { course_id: 11, batch_id: 2, semester: '1', subject_code: 'COURSE101', subject_name: 'SAVED COURSE NAME',
    subject_type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100, is_required: true, roster_verified: true, status: 'active' };
  const state = { courses: [course, { ...course, course_id: 12, subject_code: 'LAB102', subject_type: 'lab', credits: 2 },
    { ...course, course_id: 13, subject_code: 'INACTIVE', status: 'inactive' },
    { ...course, course_id: 99, batch_id: 3 }, { ...course, course_id: 22, semester: '2' }],
    sessions: [{ exam_session_id: 20, batch_id: 2, semester: '1', exam_start_month: 5, exam_start_year: 2026, exam_end_month: 6, exam_end_year: 2026 }],
    subjects: [{ ...course, subject_id: 101, exam_session_id: 10 }], commits: 0, rollbacks: 0, calls: [], failInsert: false };
  const noAcademicWrites = () => assert.fail('No academic history, course definition or faculty assignments may be changed');
  let tail = Promise.resolve();
  const db = {
    AcademicCourse: { findAll: async options => { state.calls.push(['courses', options]); return state.courses.filter(row => String(row.batch_id) === String(options.where.batch_id) && row.semester === options.where.semester).map(copy); }, update: noAcademicWrites, create: noAcademicWrites },
    ExamSession: { findByPk: async (id, options) => { state.calls.push(['session', options]); return state.sessions.find(row => String(row.exam_session_id) === String(id)); } },
    Batch: { findByPk: async (id, options) => { state.calls.push(['batch', options]); return String(id) === '2' ? { batch_id: 2 } : null; } },
    Subject: { findAll: async options => state.subjects.filter(row => String(row.exam_session_id) === String(options.where.exam_session_id)).map(copy),
      bulkCreate: async (rows, options) => {
        assert.ok(options.transaction);
        state.subjects.push(...rows.map((row, index) => ({ ...row, subject_id: 200 + state.subjects.length + index })));
        if (state.failInsert) throw new Error('Synthetic insert failure');
        return rows;
      } },
    Result: { create: noAcademicWrites, update: noAcademicWrites }, SubjectResult: { create: noAcademicWrites, update: noAcademicWrites },
    SubjectFaculty: { create: noAcademicWrites, update: noAcademicWrites }, RevaluationResult: { create: noAcademicWrites, update: noAcademicWrites },
    sequelize: { transaction: async fn => {
      const prior = tail; let release; tail = new Promise(resolve => { release = resolve; }); await prior;
      const before = copy(state.subjects), transaction = { LOCK: { UPDATE: 'UPDATE' } };
      try { const value = await fn(transaction); state.commits++; return value; }
      catch (error) { state.subjects = before; state.rollbacks++; throw error; }
      finally { release(); }
    } }
  };
  const service = load('../services/subjectReuseService', { '../database/models': db, './academicCourseService': { fields } });
  const controller = load('../controllers/subjectController', { '../database/models': db, '../services/subjectReuseService': service });
  const router = load('../routes/subjectRoutes', { '../controllers/subjectController': controller, '../controllers/academicCoursesController': {
    redirectLegacy() {}, confirm() {}, edit() {}, page() {}
  } });
  async function invoke(method, body = {}, query = {}) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await controller[method]({ params: { exam_session_id: '20' }, body, query }, res); return res;
  }
  return { state, service, controller, router, invoke };
}
test('existing semester definitions are listed even when the new session has no offerings', async () => {
  const f = fixture(), response = await f.invoke('reusable');
  assert.equal(response.code, 200); assert.equal(response.body.session.label, 'Semester 1 - May / Jun 2026');
  assert.deepEqual(Array.from(response.body.courses, row => Number(row.course_id)), [11, 12]);
  assert.ok(response.body.courses.every(row => !row.already_added));
  assert.equal(f.state.subjects.length, 1); assert.equal(f.state.commits, 0);
});
test('reuse creates new offerings with original course IDs and exact saved definitions, ignoring submitted definitions', async () => {
  const f = fixture(), list = (await f.invoke('reusable')).body;
  const beforeCourses = JSON.stringify(f.state.courses), beforeHistory = JSON.stringify(f.state.subjects[0]);
  const response = await f.invoke('reuse', { batch_id: 2, snapshot: list.snapshot, course_ids: [11, 12], subject_name: 'TAMPERED', credits: 99, max_marks: 1 });
  assert.equal(response.code, 201); assert.equal(response.body.count, 2);
  const added = f.state.subjects.filter(row => row.exam_session_id === 20);
  assert.deepEqual(added.map(row => row.course_id), [11, 12]);
  assert.equal(added[0].subject_name, 'SAVED COURSE NAME'); assert.equal(added[0].credits, 4); assert.equal(added[0].max_marks, 100);
  assert.ok(added.every(row => typeof row.subject_uuid === 'string'));
  assert.equal(JSON.stringify(f.state.courses), beforeCourses); assert.equal(JSON.stringify(f.state.subjects[0]), beforeHistory);
  assert.ok(f.state.calls.some(([model, options]) => model === 'session' && options.lock));
  assert.ok(f.state.calls.some(([model, options]) => model === 'batch' && options.lock));
});
test('already-added courses/codes remain visible but cannot be duplicated or overwrite legacy offerings', async () => {
  const f = fixture(); f.state.subjects.push({ ...f.state.subjects[0], subject_id: 102, exam_session_id: 20, course_id: null });
  const list = (await f.invoke('reusable')).body;
  assert.equal(list.courses.find(row => row.course_id === 11).already_added, true);
  assert.equal((await f.invoke('reuse', { snapshot: list.snapshot, course_ids: [11] })).code, 409);
  assert.equal(f.state.subjects.length, 2);
});
test('foreign-batch, wrong-semester, inactive and unknown courses reject the complete request', async () => {
  for (const courseId of [99, 22, 13, 999]) {
    const f = fixture(), list = (await f.invoke('reusable')).body;
    const response = await f.invoke('reuse', { snapshot: list.snapshot, course_ids: [11, courseId] });
    assert.equal(response.code, 409); assert.equal(f.state.subjects.length, 1); assert.equal(f.state.commits, 0);
  }
});
test('malformed requests and a mismatched selected batch are rejected server-side', async () => {
  const f = fixture(), list = (await f.invoke('reusable')).body;
  for (const course_ids of [[], [11, 11], [11, '11'], ['1 OR 1=1'], [-1], [0], [[11]], '11']) {
    assert.equal((await f.invoke('reuse', { snapshot: list.snapshot, course_ids })).code, 400);
  }
  assert.equal((await f.invoke('reuse', { course_ids: [11] })).code, 400);
  assert.equal((await f.invoke('reusable', {}, { batch_id: '3' })).code, 400);
  assert.equal((await f.invoke('reusable', {}, { batch_id: ['2'] })).code, 400);
  assert.equal((await f.invoke('reuse', { batch_id: 3, snapshot: list.snapshot, course_ids: [11] })).code, 400);
  assert.equal(f.state.subjects.length, 1);
});
test('stale course definitions, roster flags, period, existing offerings and semester reject confirmation', async () => {
  for (const change of ['name', 'roster', 'period', 'offering', 'semester']) {
    const f = fixture(), list = (await f.invoke('reusable')).body;
    if (change === 'name') f.state.courses[0].subject_name = 'CHANGED';
    else if (change === 'roster') f.state.courses[0].is_required = false;
    else if (change === 'period') f.state.sessions[0].exam_end_month = 7;
    else if (change === 'offering') f.state.subjects.push({ ...f.state.subjects[0], subject_id: 102, exam_session_id: 20 });
    else f.state.sessions[0].semester = '2';
    const before = JSON.stringify(f.state.subjects);
    const response = await f.invoke('reuse', { snapshot: list.snapshot, course_ids: [11] });
    assert.equal(response.code, 409); assert.match(response.body.message, /changed/);
    assert.equal(JSON.stringify(f.state.subjects), before);
  }
});
test('concurrent reuse requests cannot duplicate offerings and failed insertions roll back', async () => {
  const f = fixture(), list = (await f.invoke('reusable')).body;
  const responses = await Promise.all([f.invoke('reuse', { snapshot: list.snapshot, course_ids: [11] }), f.invoke('reuse', { snapshot: list.snapshot, course_ids: [11] })]);
  assert.deepEqual(responses.map(row => row.code).sort(), [201, 409]);
  assert.equal(f.state.subjects.filter(row => row.exam_session_id === 20).length, 1);
  const failed = fixture(), original = (await failed.invoke('reusable')).body; failed.state.failInsert = true;
  assert.equal((await failed.invoke('reuse', { snapshot: original.snapshot, course_ids: [11, 12] })).code, 500);
  assert.equal(failed.state.subjects.length, 1); assert.equal(failed.state.rollbacks, 1);
});
test('a broken saved course definition is rejected rather than copied into the new session', async () => {
  const f = fixture(); f.state.courses[0].max_marks = 90;
  const list = (await f.invoke('reusable')).body;
  assert.equal((await f.invoke('reuse', { snapshot: list.snapshot, course_ids: [11] })).code, 409);
  assert.equal(f.state.subjects.length, 1);
});
test('new reuse endpoints require administrator authorization, including direct requests', async () => {
  const f = fixture(), app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { role: req.get('x-role') || 'admin' }; next(); }); app.use('/subjects', f.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const role of ['faculty', 'student', 'guest']) {
      for (const [suffix, method] of [['reusable', 'GET'], ['reuse', 'POST']]) {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/subjects/session/20/' + suffix,
          { method, headers: { 'x-role': role, Accept: 'application/json' } });
        assert.equal(response.status, 403);
      }
    }
    assert.equal(f.state.calls.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('subjects page exposes an accessible reuse picker only to administrators', async () => {
  const file = path.join(__dirname, '../views/subjects/index.ejs');
  const html = await ejs.renderFile(file, { canManageRoster: true });
  assert.match(html, /id="reuseSubjectsBtn" disabled>Use Existing Subjects/);
  assert.match(html, /id="reuseSubjectsModal"[^>]*aria-labelledby="reuseSubjectsTitle"/);
  assert.match(html, /Select all available subjects/); assert.match(html, /Add selected subjects/);
  assert.match(html, /src="\/js\/subjects-reuse.js"/);
  assert.ok(html.indexOf('id="subjectsToastContainer"') > html.indexOf('id="createSubjectBtn"'));
  assert.match(html, /class="subjects-header-notices"/);
  assert.doesNotMatch(await ejs.renderFile(file, { canManageRoster: false }), /id="reuseSubjectsBtn"/);
});

function browserFixture(courses = [{ course_id: 11, subject_code: 'OLD101', subject_name: 'ALREADY OFFERED', already_added: true },
  { course_id: 12, subject_code: 'OLD102', subject_name: 'EXISTING COURSE', credits: 4, max_internal: 50, max_external: 50, max_marks: 100, already_added: false }]) {
  function element(tag = 'div') {
    const handlers = {}, classes = new Set();
    return { tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, isConnected: true, disabled: false, checked: false, textContent: '',
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { this.attributes[name] = value; }, appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; },
      addEventListener(event, handler) { (handlers[event] ||= []).push(handler); },
      async dispatch(event) { for (const handler of handlers[event] || []) await handler(); },
      dispatchEvent(event) { return this.dispatch(event.type); },
      querySelectorAll(selector) {
        const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
        return descendants(this).filter(child => child.tagName === 'INPUT' && child.dataset.courseId
          && (!selector.includes(':checked') || child.checked) && (!selector.includes(':not(:disabled)') || !child.disabled));
      }
    };
  }
  const ids = ['reuseSubjectsBtn','subjectBatchSelect','subjectSessionSelect','reuseSubjectsModal','reuseSubjectsRows','reuseSubjectsAll',
    'reuseSubjectsSave','reuseSubjectsError','reuseSubjectsCount','reuseSubjectsScope','reuseSubjectsReload','subjectsToastContainer'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  elements.subjectBatchSelect.value = '2'; elements.subjectBatchSelect.selectedOptions = [{ textContent: 'Batch 2025' }];
  elements.subjectSessionSelect.value = '20'; elements.subjectSessionSelect.selectedOptions = [{ textContent: 'Semester 1 - May / Jun 2026' }];
  const requests = [], state = { courses, pending: null, rejected: false, timers: [], closed: [] }; let initialize;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/subjects-reuse'), 'utf8'), {
    document: { getElementById: id => elements[id], createElement: element, addEventListener(event, handler) { initialize = handler; } },
    bootstrap: { Modal: { getOrCreateInstance: () => ({ show() {}, hide() {} }) },
      Alert: { getOrCreateInstance: notice => ({ close() { notice.isConnected = false; state.closed.push(notice); } }) } }, Event: class { constructor(type) { this.type = type; } },
    setTimeout(callback, delay) { state.timers.push({ callback, delay }); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (state.pending) await state.pending;
      return { ok: !state.rejected, status: state.rejected ? 409 : 200, json: async () => state.rejected ? { message: 'The course roster changed. Reload the list.' }
        : options.method === 'POST' ? { count: 1 } : { snapshot: 'server-snapshot', session: { label: 'Semester 1 - May / Jun 2026' }, courses: state.courses } };
    }
  });
  initialize(); return { elements, requests, state };
}
test('browser picker selects only available subjects and submits IDs/snapshot to the captured session', async () => {
  const f = browserFixture(), el = f.elements;
  assert.equal(el.reuseSubjectsBtn.disabled, false);
  await el.reuseSubjectsBtn.dispatch('click');
  assert.match(f.requests[0].url, /session\/20\/reusable\?batch_id=2/);
  const inputs = el.reuseSubjectsRows.querySelectorAll('input[data-course-id]');
  assert.equal(inputs[0].disabled, true); assert.equal(inputs[1].disabled, false);
  assert.equal(el.reuseSubjectsSave.disabled, true);
  el.reuseSubjectsAll.checked = true; await el.reuseSubjectsAll.dispatch('change');
  assert.equal(inputs[0].checked, false); assert.equal(inputs[1].checked, true);
  assert.equal(el.reuseSubjectsSave.disabled, false);
  await el.reuseSubjectsSave.dispatch('click');
  const request = f.requests.find(row => row.options.method === 'POST');
  assert.equal(request.url, '/subjects/session/20/reuse');
  assert.deepEqual(JSON.parse(request.options.body), { batch_id: '2', course_ids: ['12'], snapshot: 'server-snapshot' });
  const notice = el.subjectsToastContainer.children[0], close = notice.children.find(child => child.tagName === 'BUTTON');
  assert.match(notice.className, /alert-dismissible/);
  assert.equal(close.className, 'btn-close');
  assert.equal(close.attributes['data-bs-dismiss'], 'alert');
  assert.equal(close.attributes['aria-label'], 'Dismiss notification');
  assert.equal(f.state.timers[0].delay, 5000);
  f.state.timers[0].callback(); assert.equal(f.state.closed.length, 1);
  f.state.timers[0].callback(); assert.equal(f.state.closed.length, 1, 'Already-dismissed notifications are not closed again');
});
test('browser cannot reuse an empty list or a stale response from a previously selected session', async () => {
  const empty = browserFixture([]); await empty.elements.reuseSubjectsBtn.dispatch('click');
  assert.equal(empty.elements.reuseSubjectsAll.disabled, true); assert.equal(empty.elements.reuseSubjectsSave.disabled, true);
  assert.match(empty.elements.reuseSubjectsRows.children[0].children[0].textContent, /No existing courses/);
  const f = browserFixture(); let release; f.state.pending = new Promise(resolve => { release = resolve; });
  const pending = f.elements.reuseSubjectsBtn.dispatch('click');
  f.elements.subjectSessionSelect.value = '21'; await f.elements.subjectSessionSelect.dispatch('change');
  release(); await pending;
  assert.equal(f.elements.reuseSubjectsRows.querySelectorAll('input[data-course-id]').length, 0);
  assert.equal(f.elements.reuseSubjectsSave.disabled, true);
});
test('browser shows a stale-configuration error and requires a reload before another confirmation', async () => {
  const f = browserFixture(), el = f.elements;
  await el.reuseSubjectsBtn.dispatch('click'); el.reuseSubjectsAll.checked = true; await el.reuseSubjectsAll.dispatch('change');
  f.state.rejected = true; await el.reuseSubjectsSave.dispatch('click');
  assert.match(el.reuseSubjectsError.textContent, /roster changed/); assert.equal(el.reuseSubjectsSave.disabled, true);
});
