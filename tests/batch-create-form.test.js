'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

function fixture(department = { department_id: 42 }) {
  const writes = [], lookups = [];
  const models = {
    Batch: { create: async data => { writes.push(data); return data; } },
    Department: { findOne: async query => { lookups.push(query); return department && (query.where.department_id === undefined || query.where.department_id === department.department_id) ? department : null; } }
  };
  const context = { module: { exports: {} }, require: () => models };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/batchController.js'), 'utf8'), context);
  async function create(body) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await context.module.exports.create({ body }, response);
    return response;
  }
  return { create, writes, lookups };
}
const input = { batch_uuid: '00000000-0000-4000-8000-000000000001', course_name: 'MCA', batch_year: 2025, start_year: 2025, end_year: 2027, status: 'active' };

test('split course/year composes stored batch name and validates the selected active department', async () => {
  const f = fixture();
  const response = await f.create({ ...input, course_name: '  MCA  ', department_id: 42, batch_name: 'Tampered Name' });
  assert.equal(response.statusCode, 201);
  assert.equal(f.writes[0].batch_name, 'MCA 2025');
  assert.equal(f.writes[0].department_id, 42);
  assert.equal(f.writes[0].course_name, undefined);
  assert.equal(f.writes[0].batch_year, undefined);
  assert.equal(f.lookups[0].where.department_id, 42);
  assert.equal(f.lookups[0].where.status, 'active');
  assert.equal(f.lookups[0].where.deleted_at, null);
  await f.create({ ...input, course_name: 'BTech', batch_year: '2026' });
  assert.equal(f.writes[1].batch_name, 'BTech 2026');
  assert.equal(f.writes[1].department_id, 42);
  assert.equal(f.lookups[1].where.department_code, 'MCA');
  assert.equal((await f.create({ ...input, department_id: ['42'] })).statusCode, 400);
  assert.equal((await f.create({ ...input, department_id: 999 })).statusCode, 409);
  const other = fixture({ department_id: 7 });
  assert.equal((await other.create({ ...input, department_id: 7 })).statusCode, 201);
  assert.equal(other.writes[0].department_id, 7);
});

test('invalid course/year/ranges/status never save; missing MCA configuration fails safely', async () => {
  const f = fixture();
  for (const changes of [{ course_name: '' }, { course_name: [] }, { course_name: '<script>' }, { course_name: 'x'.repeat(91) }, { batch_year: '' }, { batch_year: [] }, { batch_year: 1899 }, { batch_year: 2201 }, { batch_year: 2025.5 }, { start_year: 1899 }, { end_year: 2024 }, { status: 'deleted' }]) {
    const response = await f.create({ ...input, ...changes });
    assert.equal(response.statusCode, 400, JSON.stringify(changes));
  }
  assert.equal(f.writes.length, 0);
  const missing = fixture(null);
  assert.equal((await missing.create(input)).statusCode, 409);
  assert.equal(missing.writes.length, 0);
});

test('legacy batch_name payload remains compatible and validates the chosen department', async () => {
  const f = fixture();
  const { course_name, batch_year, ...legacy } = input;
  assert.equal((await f.create({ ...legacy, batch_name: 'MCA 2025', department_id: 42 })).statusCode, 201);
  assert.equal(f.writes[0].batch_name, 'MCA 2025'); assert.equal(f.writes[0].department_id, 42);
  assert.equal(f.lookups[0].where.department_id, 42);
});

test('Create New Batch renders separate course/year inputs, year picker, and department dropdown', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/batches/index.ejs'), { batches: [], departments: [] });
  const create = html.slice(html.indexOf('id="createBatchForm"'), html.indexOf('id="confirmCreateModal"'));
  assert.match(create, /id="createBatchCourseName" name="course_name" maxlength="90" placeholder="MCA"/);
  assert.match(create, /id="createBatchYear" name="batch_year"/);
  assert.match(create, /aria-controls="createBatchYearPicker"/);
  assert.match(create, /<select[^>]*id="createBatchDepartment"/);
  assert.doesNotMatch(create, /id="createBatchDepartment" value="MCA" readonly/);
  assert.doesNotMatch(create, /id="createBatchName"/);
  assert.match(html, /<select[^>]*id="editBatchDepartment"/);
});
