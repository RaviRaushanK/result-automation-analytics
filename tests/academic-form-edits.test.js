'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const options = require('../public/js/academic-form-options');
const email = require('../public/js/faculty-email-validation');

test('invalid top-level email domains are rejected without restricting institutional addresses', () => {
  for (const value of ['faculty@gmail.clh', 'faculty@college.invalid', 'faculty@college.zzzz']) assert.ok(email.getError(value), value);
  for (const value of ['faculty@gmail.com', 'faculty@college.edu.in', 'faculty@college.ac.in', 'faculty@college.education', 'faculty@college.org', '']) assert.equal(email.getError(value), '', value);
});

test('split batch fields support new names and preserve descriptive legacy names', () => {
  assert.deepEqual(options.splitBatchName({ batch_name: 'MCA 2025', start_year: 2025 }), { course_name: 'MCA', batch_year: 2025 });
  assert.deepEqual(options.splitBatchName({ batch_name: 'BTech2026', start_year: 2026 }), { course_name: 'BTech', batch_year: 2026 });
  assert.deepEqual(options.splitBatchName({ batch_name: '25th MCA Batch', start_year: 2025 }), { course_name: '25th MCA Batch', batch_year: 2025 });
});

test('current session prefers current month, otherwise latest past or nearest future, never arbitrary array order', () => {
  const now = new Date(2026, 9, 14);
  const past = { session_id: 1, exam_session: 'September', exam_year: 2026 };
  const older = { session_id: 2, exam_session: 'Jun', exam_year: 2026 };
  const next = { session_id: 3, exam_session: 'Nov', exam_year: 2026 };
  const current = { session_id: 4, exam_session: 'Oct', exam_year: 2026 };
  assert.equal(options.currentSession([older, next, past], now), past);
  assert.equal(options.currentSession([older, current, next, past], now), current);
  assert.equal(options.currentSession([{ ...next, exam_year: 2027 }, next], now), next);
  assert.equal(options.currentSession([{ exam_year: 2026, exam_session: 'invalid' }], now), null);
  assert.equal(options.currentSession([], now), null);
});

function serviceFixture({ results = 0, duplicate = false, linked = true } = {}) {
  const definition = { subject_code: 'MCA101', subject_name: 'Original Course', subject_type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const writes = [];
  const course = { ...definition, course_id: 10, batch_id: 1, semester: '1', status: 'active', update: async data => writes.push(['course', data]) };
  const subject = { ...definition, subject_id: 20, session_id: 30, course_id: linked ? 10 : null, update: async data => writes.push(['subject', data]) };
  const models = {
    AcademicCourse: { findByPk: async () => course, findOne: async query => query.where.course_id ? duplicate ? { course_id: 11 } : null : course },
    Subject: { findAll: async () => [subject, { ...subject, subject_id: 21, session_id: 31 }], findOne: async () => null, update: async data => writes.push(['offerings', data]) },
    SubjectResult: { count: async () => results }
  };
  const context = { module: { exports: {} }, require: name => name === '../database/models' ? models : name === './academicPolicy' ? { SCHEME: 'TEST' } : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/academicCourseService'), 'utf8'), context);
  return { definition, writes, course, subject, update: changes => context.module.exports.updateOffering(subject, { batch_id: 1, semester: '1' }, { ...definition, ...changes }, { LOCK: { UPDATE: 'UPDATE' } }) };
}

test('descriptive subject edits retain historical course identity while code changes are blocked', async () => {
  const f = serviceFixture({ results: 2 });
  await assert.rejects(() => f.update({ subject_code: 'MCA102' }), /cannot change after results exist/);
  await f.update({ subject_name: 'Corrected name' });
  assert.equal(f.writes.length, 3);
  for (const [, data] of f.writes) { assert.equal(data.subject_name, 'Corrected name'); assert.equal(data.subject_code, undefined); assert.equal(data.credits, undefined); }
  assert.equal(f.writes[2][1].course_id, 10);
});

test('grading changes work before results and invalidate roster review, but never rewrite historical results', async () => {
  const before = serviceFixture(); await before.update({ credits: 3, max_internal: 40, max_external: 60 });
  assert.equal(before.writes[0][1].roster_verified, false);
  assert.equal(before.writes[1][1].max_external, 60);
  const after = serviceFixture({ results: 1 });
  await assert.rejects(() => after.update({ credits: 3 }), /cannot change after results exist/);
  assert.equal(after.writes.length, 0);
});

test('subject no-op, legacy link and duplicate code updates do not invent another course identity', async () => {
  const noop = serviceFixture({ results: 1 }); await noop.update({});
  assert.equal(noop.writes.some(([kind]) => kind === 'offerings'), false);
  const legacy = serviceFixture({ linked: false }); await legacy.update({ subject_name: 'Corrected' });
  assert.equal(legacy.writes.at(-1)[1].course_id, 10);
  const conflict = serviceFixture({ duplicate: true });
  await assert.rejects(() => conflict.update({ subject_code: 'MCA102' }), /already uses/);
  assert.equal(conflict.writes.length, 0);
});

test('month/year session corrections remain allowed with configured courses when semester is unchanged', async () => {
  const writes = [];
  const session = { session_id: 1, batch_id: 1, semester: '1' };
  const models = { sequelize: { transaction: async run => run({}) }, Result: { count: async () => 0 }, ResultSession: { findByPk: async () => session, findOne: async () => null, update: async data => writes.push(data) }, Subject: { count: async () => { throw new Error('Unchanged semester must not be rejected'); } } };
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/sessionController'), 'utf8'), context);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  await context.module.exports.update({ params: { id: 1 }, body: { semester: '01', exam_session: 'November', exam_year: 2026 } }, res);
  assert.equal(res.statusCode, 200); assert.equal(writes[0].exam_session, 'Nov');
});

test('batch update accepts split fields and rejects invalid years before writes', async () => {
  const writes = [];
  const models = { Batch: { findByPk: async () => ({ batch_id: 1, department_id: 1, batch_name: 'MCA 2024', start_year: 2025, end_year: 2027, status: 'active', update: async data => writes.push(data) }) },
    Student: { count: async () => 0 }, Result: { count: async () => 0 }, sequelize: { transaction: async callback => callback({}) } };
  const context = { module: { exports: {} }, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/batchController'), 'utf8'), context);
  async function update(body) { const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } }; await context.module.exports.update({ params: { id: 1 }, body }, res); return res; }
  assert.equal((await update({ course_name: 'MCA', batch_year: 2025 })).statusCode, 200);
  assert.equal(writes[0].batch_name, 'MCA 2025'); assert.equal(writes[0].course_name, undefined);
  assert.equal((await update({ course_name: 'MCA', batch_year: 'bad' })).statusCode, 400);
  assert.equal(writes.length, 1);
});

test('subject update controller edits the linked course instead of invoking create-time resolution', async () => {
  const subject = { subject_id: 1, session_id: 2, course_id: 3 };
  const definition = { subject_code: 'MCA101', subject_name: 'Corrected', subject_type: 'project', credits: 0, max_internal: 0, max_external: 100, max_marks: 100 };
  const calls = [];
  const models = { Batch: { findByPk: async () => ({ batch_id: 1 }) }, Subject: { findByPk: async () => subject, findOne: async () => null }, ResultSession: { findByPk: async () => ({ session_id: 2, batch_id: 1, semester: '1' }) }, sequelize: { transaction: async fn => fn({ fixture: true }) } };
  const service = { resolve: async () => { throw new Error('Create-time resolution must not run during editing'); }, updateOffering: async (...args) => calls.push(args) };
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models : name === '../services/academicCourseService' ? service : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/subjectController'), 'utf8'), context);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  await context.module.exports.update({ params: { id: 1 }, body: definition }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
  assert.equal(calls[0][0].course_id, 3); assert.equal(calls[0][2].credits, 0); assert.equal(calls[0][3].fixture, true);
});
