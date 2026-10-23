'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
function load(file, replacements, suffix = '') {
  const full = path.resolve(__dirname, '..', file), module = { exports: {} }, local = createRequire(full);
  vm.runInNewContext(fs.readFileSync(full, 'utf8') + suffix, { module, exports: module.exports, console,
    require: name => Object.hasOwn(replacements, name) ? replacements[name] : local(name) });
  return module.exports;
}
async function batchServer(t, historical = false, name = 'MCA 2025') {
  const writes = [], data = { batch_id: 1, batch_name: name, department_id: 1, start_year: 2025, end_year: 2027, status: 'active' };
  const record = { ...data, update: async (values, options) => { assert.ok(options.transaction); writes.push(values); Object.assign(data, values); } };
  const models = { Batch: { findByPk: async (id, options) => { assert.equal(options.lock, true); return record; }, destroy: async () => { writes.push('delete'); return 1; } },
    Student: { count: async () => historical ? 1 : 0 }, Result: { count: async () => historical ? 1 : 0 },
    ResultSession: { count: async () => historical ? 1 : 0 }, AcademicCourse: { count: async () => 0 },
    Department: { findOne: async () => ({ department_id: 2 }) }, sequelize: { transaction: async callback => callback({}) } };
  const controller = load('controllers/batchController.js', { '../database/models': models });
  const router = load('routes/batchRoutes.js', { '../controllers/batchController': controller });
  const app = express(); app.use(express.json()); app.use('/batches', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { data, writes, async request(body, method = 'PUT') {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/batches/1', { method,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() };
  } };
}
for (const body of [{ start_year: 2030, end_year: 2020 }, { start_year: '2e3' }, { end_year: [] }, { batch_name: '' },
  { department_id: {} }, { status: 'deleted' }, { batch_id: 2 }, { batch_uuid: 'forged' }, { deleted_at: '2026-01-01' }]) {
  test('direct batch update rejects invalid/manipulated fields ' + JSON.stringify(body), async t => {
    const f = await batchServer(t); assert.equal((await f.request(body)).status, 400); assert.equal(f.writes.length, 0);
  });
}
for (const body of [{ batch_name: 'Different cohort' }, { department_id: 2 }, { start_year: 2026 }, { end_year: 2028 }]) {
  test('historical batch identity cannot change ' + JSON.stringify(body), async t => {
    const f = await batchServer(t, true); assert.equal((await f.request(body)).status, 409); assert.equal(f.writes.length, 0);
  });
}
test('historical batch status is editable but destructive deletion is blocked', async t => {
  const f = await batchServer(t, true); assert.equal((await f.request({ status: 'inactive' })).status, 200);
  assert.equal(f.data.batch_name, 'MCA 2025'); assert.equal(f.data.status, 'inactive');
  assert.equal((await f.request({}, 'DELETE')).status, 409); assert.equal(f.writes.includes('delete'), false);
});
test('new batch corrections before dependencies retain legitimate update behavior', async t => {
  const f = await batchServer(t); assert.equal((await f.request({ batch_name: 'MCA 2026', start_year: 2026, end_year: 2028, department_id: 2 })).status, 200);
});
test('the existing split edit form can deactivate a historical compact-name batch without relabeling it', async t => {
  const f = await batchServer(t, true, 'MCA2025');
  const res = await f.request({ batch_name: 'MCA 2025', course_name: 'MCA', batch_year: 2025, start_year: 2025, end_year: 2027, department_id: 1, status: 'inactive' });
  assert.equal(res.status, 200); assert.equal(f.data.batch_name, 'MCA2025'); assert.equal(f.data.status, 'inactive');
});
test('new-batch syllabus can reuse a code without changing old course identity', async () => {
  const map = new Map(); let next = 1;
  const models = { AcademicCourse: { findOrCreate: async options => {
    const key = JSON.stringify(options.where); if (map.has(key)) return [map.get(key), false];
    const course = { ...options.defaults, course_id: next++, status: 'active' }; map.set(key, course); return [course, true];
  } }, Result: { count: async () => 0 } };
  const service = load('services/academicCourseService.js', { '../database/models': models });
  const old = { subject_code: 'MMC101', subject_name: 'Programming and Problem Solving in C', subject_type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  const oldCourse = await service.resolve({ batch_id: 1, semester: '1' }, old, {});
  const newCourse = await service.resolve({ batch_id: 2, semester: '1' }, { ...old, subject_name: 'A different new course', credits: 3 }, {});
  assert.notEqual(oldCourse.course_id, newCourse.course_id);
  const backlogCourse = await service.resolve({ batch_id: 1, semester: '1' }, old, {});
  assert.equal(backlogCourse.course_id, oldCourse.course_id); assert.equal(backlogCourse.subject_name, old.subject_name);
  await assert.rejects(service.resolve({ batch_id: 1, semester: '1' }, { ...old, subject_name: 'A different new course' }, {}), /conflicts/);
});
test('subject configuration rejects malformed codes, numeric coercions, negative credits and zero grading ceiling', () => {
  const controller = load('controllers/subjectController.js', { '../database/models': {}, '../services/academicCourseService': {} }, '\nmodule.exports.validateForTest = validateSubject;');
  const valid = { subject_code: 'MMC101', subject_name: 'Course', subject_type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 };
  for (const change of [{ subject_code: {} }, { credits: -1 }, { credits: [] }, { credits: '' }, { max_internal: '50junk' }, { max_internal: 0, max_external: 0, max_marks: 0 }, { max_marks: 99 }]) {
    assert.ok(controller.validateForTest({ ...valid, ...change }).errors.length, JSON.stringify(change));
  }
  assert.equal(controller.validateForTest({ ...valid, credits: 0, max_internal: 0, max_external: 100 }).errors.length, 0);
});
