'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const policy = require('../services/academicPolicy');
const outcomes = require('../services/academicOutcomeService');

function loadModule(file, replacements = {}) {
  const module = { exports: {} };
  const context = { module, exports: module.exports, console, URLSearchParams, require: name => replacements[name] || require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), context, { filename: file });
  return module.exports;
}
function fixture() {
  const batches = [{ batch_id: 1, batch_name: 'Older', start_year: 2024, end_year: 2026 }, { batch_id: 9, batch_name: 'BTech', start_year: 2026, end_year: 2030 }, { batch_id: 2, batch_name: 'MCA', start_year: 2025, end_year: 2027 }];
  const writes = [], calls = [];
  const course = { course_id: 11, batch_id: 2, semester: '1', subject_code: 'MCA101', subject_name: 'Course', subject_type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100, is_required: true, roster_verified: false, status: 'active', async update(data) { writes.push({ ...data }); Object.assign(this, data); } };
  const subject = { ...course, subject_id: 101, session_id: 10 };
  let unmapped = 0;
  const models = {
    Batch: { findAll: async () => { calls.push('batches'); return batches; }, findByPk: async id => batches.find(batch => String(batch.batch_id) === String(id)) },
    AcademicCourse: { findAll: async query => { calls.push({ model: 'AcademicCourse', where: query.where }); return String(query.where.batch_id) === '2' && query.where.semester === '1' ? [course] : []; } },
    Subject: { findAll: async query => { calls.push({ model: 'Subject', query }); return [subject]; }, count: async () => unmapped },
    ResultSession: {}, sequelize: { transaction: async fn => fn({ LOCK: { UPDATE: 'UPDATE' } }) }
  };
  for (const name of ['Result', 'SubjectResult', 'RevaluationResult']) models[name] = { update() { throw new Error('Historical data must not change'); }, create() { throw new Error('Historical data must not change'); } };
  models.Result.count = async () => 0;
  const courses = loadModule('../controllers/academicCoursesController', { '../database/models': models });
  const subjects = loadModule('../controllers/subjectController', { '../database/models': models });
  const router = loadModule('../routes/subjectRoutes', { '../controllers/academicCoursesController': courses, '../controllers/subjectController': subjects });
  return { batches, writes, calls, course, subject, models, courses, router, setUnmapped(value) { unmapped = value; } };
}
async function withServer(f, callback) {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views'));
  app.use(express.urlencoded({ extended: true })); app.use(express.json());
  app.use((req, res, next) => { req.user = { role: req.get('x-role') || 'admin' }; req.session = { adminId: 7 }; res.locals.user = req.user; next(); });
  app.use('/subjects', f.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try { await callback((url, opts = {}) => fetch(`http://127.0.0.1:${server.address().port}${url}`, { redirect: 'manual', ...opts })); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });

test('Examination Subjects retains session-specific controls and exposes the roster tab only to administrators', async () => {
  await withServer(fixture(), async request => {
    const admin = await (await request('/subjects', { headers: { Accept: 'text/html' } })).text();
    assert.match(admin, /Examination Subjects/); assert.match(admin, /Semester Roster/);
    for (const id of ['subjectBatchSelect', 'subjectSessionSelect', 'subjectFormModal', 'subjectConfirmModal', 'subjectDeleteModal']) assert.ok(admin.includes('id="' + id + '"'));
    assert.match(admin, /specific examination session/); assert.doesNotMatch(admin, /id="rosterConfirmation"/);
    const faculty = await (await request('/subjects', { headers: { Accept: 'text/html', 'x-role': 'faculty' } })).text();
    assert.match(faculty, /Examination Subjects/); assert.doesNotMatch(faculty, /id="semester-roster-tab"/);
  });
});

test('Semester Roster renders latest cohort with duration-derived options and no ResultSession filter', async () => {
  const f = fixture();
  await withServer(f, async request => {
    const latest = await (await request('/subjects?tab=roster')).text();
    assert.match(latest, /id="semester-roster-tab"[^>]*aria-current="page"/);
    assert.match(latest, /option value="9" selected/);
    assert.equal((latest.match(/>Semester \d+<\/option>/g) || []).length, 8);
    assert.doesNotMatch(latest, /subjectSessionSelect|name="session_id"/);
    const mca = await (await request('/subjects?tab=roster&batch_id=2&semester=1')).text();
    assert.equal((mca.match(/>Semester \d+<\/option>/g) || []).length, 4);
    assert.match(mca, /action="\/subjects\/roster"/); assert.match(mca, /name="required_courses" value="11"/);
    assert.match(mca, /name="confirm" value="1" required/); assert.match(mca, /across examination sittings/);
    assert.equal(f.calls.filter(call => call.model === 'Subject').length, 0);
    const json = await (await request('/subjects?format=json')).json();
    assert.equal(json[0].session_id, 10); assert.equal(json[0].course_id, 11);
  });
});

test('roster GET, new POST and legacy endpoints deny unauthorized roles server-side', async () => {
  const f = fixture();
  await withServer(f, async request => {
    for (const role of ['faculty', 'student', 'guest']) {
      for (const url of ['/subjects?tab=roster', '/subjects?tab=roster&format=json', '/subjects/courses', '/subjects/roster/edit?batch_id=2&semester=1']) assert.equal((await request(url, { headers: { 'x-role': role } })).status, 403);
      for (const url of ['/subjects/roster', '/subjects/courses']) assert.equal((await request(url, { ...post('batch_id=2&semester=1&confirm=1&required_courses=11'), headers: { 'x-role': role, 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 403);
    }
    assert.deepEqual(f.writes, []); assert.deepEqual(f.calls, []);
  });
});

test('legacy Semester Courses GET redirects to the integrated tab and preserves only compatible parameters', async () => {
  const f = fixture();
  await withServer(f, async request => {
    const bare = await request('/subjects/courses'); assert.equal(bare.status, 302); assert.equal(bare.headers.get('location'), '/subjects?tab=roster');
    const res = await request('/subjects/courses?batch_id=2&semester=3&saved=1&next=https://example.com');
    const url = new URL(res.headers.get('location'), 'http://localhost');
    assert.equal(url.pathname, '/subjects'); assert.equal(url.searchParams.get('tab'), 'roster');
    assert.equal(url.searchParams.get('batch_id'), '2'); assert.equal(url.searchParams.get('semester'), '3'); assert.equal(url.searchParams.get('saved'), '1'); assert.equal(url.searchParams.has('next'), false);
    assert.equal((await request('/subjects/courses?batch_id=bad')).status, 400);
    assert.deepEqual(f.calls, []);
  });
});

test('invalid duration-specific semesters and unknown batches are rejected on GET and POST without review writes', async () => {
  const f = fixture();
  await withServer(f, async request => {
    for (const query of ['batch_id=2&semester=5', 'batch_id=2&semester=0', 'batch_id=2&semester=1.5', 'batch_id=999&semester=1', 'batch_id=2&semester=1&semester=2']) assert.equal((await request('/subjects?tab=roster&' + query)).status, 400);
    for (const body of ['batch_id=2&semester=5&confirm=1&required_courses=11', 'batch_id=2&semester=1&required_courses=11', 'batch_id=2&semester=1&confirm=1&required_courses=999', 'batch_id=2&semester=1&confirm=1&required_courses=11&required_courses=11']) assert.equal((await request('/subjects/roster', post(body))).status, 400);
    assert.deepEqual(f.writes, []);
  });
});

test('roster confirmation retains stable course identity, review provenance and unmapped-offering protection', async () => {
  const f = fixture();
  await withServer(f, async request => {
    const body = 'batch_id=2&semester=1&confirm=1&required_courses=11';
    f.setUnmapped(1); assert.equal((await request('/subjects/roster', post(body))).status, 409); assert.equal(f.writes.length, 0);
    f.setUnmapped(0); const res = await request('/subjects/roster', post(body));
    assert.equal(res.status, 302); assert.match(res.headers.get('location'), /^\/subjects\?tab=roster&batch_id=2&semester=1&saved=1$/);
    assert.equal(f.course.course_id, 11); assert.equal(f.course.subject_code, 'MCA101'); assert.equal(f.subject.session_id, 10);
    assert.deepEqual(Object.keys(f.writes[0]).sort(), ['is_required', 'reviewed_at', 'reviewed_by', 'roster_verified']);
    assert.equal(f.writes[0].reviewed_by, 7); assert.equal(f.writes[0].roster_verified, true);
    assert.equal((await request('/subjects/courses', post(body))).status, 302);
  });
});

test('verification through the new tab unlocks the unchanged REGULAR import and academic outcome consumers', async () => {
  const f = fixture();
  const importer = loadModule('../controllers/resultController', { '../database/models': f.models });
  const inputs = { internal_101: 40, external_101: 40 }, session = { batch_id: 2, semester: '1' };
  const before = await importer._test.buildValidatedPayload(10, { usn: 'TEST', name: 'Test' }, inputs, { session, exam_type: 'REGULAR' });
  assert.equal(before.hasErrors, true); assert.match(before.errors.form, /Confirm the required semester courses/);
  const result = { result_id: 1, student_id: 1, session_id: 10, semester: '1', exam_session: 'Dec', exam_year: 2025, exam_type: 'REGULAR', attempt_no: 1 };
  const data = { courses: [f.course], results: [result], subjects: [{ ...result, course_id: 11, course_id_snapshot: 11, outcome_status: 'pass', grade: 'A+', grade_point: 9, credits_snapshot: 4, grading_scheme_version: policy.SCHEME }] };
  assert.equal(outcomes.semesterOutcome(data, 1, '1').cleared, null); assert.equal(outcomes.cumulative(data, 1, '1'), null);
  await withServer(f, async request => assert.equal((await request('/subjects/roster', post('batch_id=2&semester=1&confirm=1&required_courses=11'))).status, 302));
  const after = await importer._test.buildValidatedPayload(10, { usn: 'TEST', name: 'Test' }, inputs, { session, exam_type: 'REGULAR' });
  assert.equal(after.hasErrors, false); assert.equal(after.payload.subjects[0].course_id, 11);
  assert.equal(outcomes.semesterOutcome(data, 1, '1').cleared, true); assert.equal(outcomes.cumulative(data, 1, '1'), 9);
});

test('roster batch changes restrict semester options and prevent submitting the old roster', () => {
  const f = fixture(), nodes = {};
  function node(value = '') { return { value, hidden: false, disabled: false, options: [], classList: { remove() {} }, events: {}, addEventListener(name, fn) { this.events[name] = fn; }, replaceChildren() { this.options = []; this.value = ''; }, add(option) { if (!this.options.length) this.value = option.value; this.options.push(option); } }; }
  for (const id of ['course-batch', 'course-semester', 'loadRosterBtn', 'rosterContent', 'rosterSelectionChanged', 'confirmRosterBtn', 'rosterSaved', 'examination-subjects-tab']) nodes[id] = node();
  nodes['course-batch'].value = '9';
  const context = { setTimeout() {}, document: { querySelector: () => ({ dataset: { batches: JSON.stringify(f.batches) } }), getElementById: id => nodes[id] }, Option: function (text, value) { this.text = text; this.value = value; }, AcademicFormOptions: require('../public/js/academic-form-options') };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/subjects-roster'), 'utf8'), context);
  for (const [id, count] of [['2', 4], ['9', 8], ['', 1]]) {
    nodes['course-batch'].value = id; nodes['course-batch'].events.change();
    assert.equal(nodes['course-semester'].options.length, count); assert.equal(nodes.rosterContent.hidden, true); assert.equal(nodes.confirmRosterBtn.disabled, true);
  }
  assert.equal(nodes['course-semester'].disabled, true); assert.equal(nodes.loadRosterBtn.disabled, true);
});

test('empty batches and invalid batch durations are handled without inventing semesters', async () => {
  const f = fixture(); f.batches.splice(0, f.batches.length);
  await withServer(f, async request => assert.match(await (await request('/subjects?tab=roster')).text(), /No batches available/));
  f.batches.push({ batch_id: 8, batch_name: 'Invalid duration', start_year: 2025, end_year: 2025 });
  await withServer(f, async request => {
    assert.match(await (await request('/subjects?tab=roster')).text(), /No semester range available/);
    assert.equal((await request('/subjects?tab=roster&batch_id=8&semester=1')).status, 400);
  });
});

test('sidebar keeps only Subjects navigation without a standalone roster entry', () => {
  const flatten = items => items.flatMap(item => [item, ...flatten(item.children || [])]);
  const items = flatten(require('../config/sidebar.json').menu);
  assert.equal(items.filter(item => item.route === '/subjects').length, 1);
  assert.equal(items.some(item => item.route === '/subjects/courses' || item.label === 'Semester Courses'), false);
});

test('verified roster hides selection and confirmation controls until explicit editing; Cancel returns to read-only scope', async () => {
  const f = fixture(); f.course.roster_verified = true;
  await withServer(f, async request => {
    const view = await (await request('/subjects?tab=roster&batch_id=2&semester=1')).text();
    assert.match(view, /Edit Required Courses/); assert.doesNotMatch(view, /name="required_courses"|name="confirm"/);
    const edit = await (await request('/subjects?tab=roster&batch_id=2&semester=1&edit=1')).text();
    assert.match(edit, /name="required_courses"/); assert.match(edit, /id="rosterReviewModal"/);
    assert.match(edit, /id="rosterAcknowledge"[^>]*required disabled/);
    assert.match(edit, /href="\/subjects\?tab=roster&amp;batch_id=2&amp;semester=1" id="cancelRosterEdit"/);
    assert.equal(f.writes.length, 0);
  });
});

test('correcting an accidental required-course selection keeps the course identity and updates only roster metadata', async () => {
  const f = fixture(); f.course.roster_verified = true;
  const extra = { ...f.course, course_id: 12, subject_code: 'EXTRA', async update(data) { Object.assign(this, data); f.writes.push(data); } };
  f.models.AcademicCourse.findAll = async () => [f.course, extra];
  await withServer(f, async request => {
    const res = await request('/subjects/roster', post('batch_id=2&semester=1&confirm=1&required_courses=11'));
    assert.equal(res.status, 302); assert.equal(extra.is_required, false); assert.equal(extra.roster_verified, true);
    assert.equal(extra.course_id, 12); assert.equal(extra.subject_code, 'EXTRA');
    assert.ok(f.writes.every(write => !('subject_code' in write) && !('course_id' in write)));
    const view = await (await request(res.headers.get('location'))).text();
    assert.match(view, /Not required/); assert.doesNotMatch(view, /name="required_courses"|name="confirm"/);
  });
});

test('Add Faculty form no longer collects email while preserving existing optional-email API compatibility', async () => {
  const ejs = require('ejs');
  const view = await ejs.renderFile(require.resolve('../views/faculty/index.ejs'), {});
  assert.doesNotMatch(view, /facultyEmailInput|facultyEmailFeedback|faculty-email-validation.js/);
  const source = fs.readFileSync(require.resolve('../public/js/faculty'), 'utf8');
  assert.doesNotMatch(source, /facultyEmailInput|validateFacultyEmail|draft\.email/);
});

test('actual Edit Required Courses link opens the dedicated edit endpoint with the same batch and semester', async () => {
  const f = fixture(); f.course.roster_verified = true;
  await withServer(f, async request => {
    const html = await (await request('/subjects?tab=roster&batch_id=2&semester=1')).text();
    const href = html.match(/id="editRosterBtn" href="([^"]+)"/)[1].replace(/&amp;/g, '&');
    assert.equal(href, '/subjects/roster/edit?batch_id=2&semester=1');
    const response = await request(href); assert.equal(response.status, 200);
    const edit = await response.text();
    assert.match(edit, /Editing verified roster/); assert.match(edit, /name="required_courses" value="11"/);
    assert.match(edit, /id="reviewRosterBtn"/); assert.match(edit, /id="cancelRosterEdit"/);
    assert.equal((await request('/subjects/roster/edit?batch_id=2&semester=5')).status, 400);
    assert.deepEqual(f.writes, []);
  });
});

test('required-course changes with saved Result history are rejected without rewriting roster or marks', async () => {
  const f = fixture(); f.course.is_required = false; f.models.Result.count = async () => 1;
  await withServer(f, async request => {
    const response = await request('/subjects/courses', post('batch_id=2&semester=1&confirm=1&required_courses=11'));
    assert.equal(response.status, 409); assert.match(await response.text(), /cannot change after this semester has saved results/);
    assert.equal(f.writes.length, 0); assert.equal(f.course.is_required, false);
  });
});
