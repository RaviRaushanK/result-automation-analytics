'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const { DataTypes } = require('sequelize');
const db = require('../database/models');
const service = require('../services/studentCategoryService');
const reportsRepository = require('../repositories/reportsRepository');
after(() => db.sequelize.close());

test('admission category validation preserves recorded values and never invents a default', () => {
  assert.equal(service.category(' PGCET '), 'PGCET');
  assert.equal(service.category('MGT'), 'MGT');
  assert.equal(service.category('Other quota'), 'Other quota');
  assert.equal(service.category(''), null);
  assert.equal(service.category(null), null);
  for (const value of [undefined, [], {}, 42, 'a'.repeat(31), 'MGT\n', '\0PGCET']) assert.throws(() => service.category(value));
  assert.equal(db.Student.rawAttributes.category.allowNull, true);
  assert.equal(db.Student.rawAttributes.category.defaultValue, null);
});

test('category migration only adds a nullable string column and does not backfill', async () => {
  const migration = require('../migrations/20261002180000-student-admission-category');
  const columns = {}; const additions = []; const removals = [];
  const qi = { describeTable: async table => { assert.equal(table, 'students'); return columns; },
    addColumn: async (table, name, options) => { additions.push({ table, name, options }); columns[name] = options; },
    removeColumn: async (table, name) => removals.push({ table, name }) };
  await migration.up(qi, DataTypes); await migration.up(qi, DataTypes);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].name, 'category');
  assert.equal(additions[0].options.type.options.length, 30);
  assert.equal(additions[0].options.allowNull, true);
  assert.equal(additions[0].options.defaultValue, null);
  await migration.down(qi);
  assert.deepEqual(removals, [{ table: 'students', name: 'category' }]);
});

test('category page and writes enforce roles, ownership and update only category', async () => {
  const saved = { batch: db.Batch.findOne, student: db.Student.findOne, count: db.Student.count, all: db.Student.findAll, options: reportsRepository.options };
  const writes = [];
  const record = { student_id: 1, usn: 'USN1', student_name: 'Student One', category: null,
    update: async changes => { writes.push(changes); record.category = changes.category; } };
  db.Batch.findOne = async ({ where }) => where.batch_id === 1 ? { batch_id: 1 } : null;
  db.Student.findOne = async ({ where }) => { assert.equal(where.deleted_at, null); return where.student_id === 1 && where.batch_id === 1 ? record : null; };
  db.Student.count = async () => 1;
  db.Student.findAll = async () => [record];
  reportsRepository.options = async () => [{ batch_id: 1, batch_name: 'MCA 2025' }];
  const app = express(); app.use(express.json());
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views'));
  app.use((req, res, next) => { req.session = req.headers['x-test-role'] ? { adminId: 1, role: req.headers['x-test-role'] } : {}; next(); });
  app.use('/students', require('../routes/studentsRoutes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (role, body, student = 1) => fetch(`${base}/students/api/${student}/category`, { method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/students', { headers: { Accept: 'application/json' } })).status, 401);
    assert.equal((await fetch(base + '/students', { headers: { Accept: 'application/json', 'x-test-role': 'student' } })).status, 403);
    assert.equal((await request(undefined, { batch_id: 1, category: 'MGT' })).status, 401);
    assert.equal((await request('student', { batch_id: 1, category: 'MGT' })).status, 403);
    assert.equal(writes.length, 0);
    for (const role of ['admin', 'faculty']) {
      const response = await request(role, { batch_id: 1, category: ' PGCET ', student_name: 'Wrong name', batch: 2 });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).student.category, 'PGCET');
    }
    assert.deepEqual(writes, [{ category: 'PGCET' }, { category: 'PGCET' }]);
    const page = await fetch(base + '/students?batch_id=1', { headers: { 'x-test-role': 'faculty' } });
    assert.equal(page.status, 200); assert.match(await page.text(), /value="PGCET"/);
    assert.equal((await request('faculty', { batch_id: 2, category: 'MGT' })).status, 404);
    assert.equal((await request('faculty', { batch_id: 1, category: 'MGT' }, 999)).status, 404);
    assert.equal((await request('faculty', { batch_id: 1 })).status, 400);
    assert.equal((await request('faculty', { batch_id: 1, category: 'a'.repeat(31) })).status, 400);
    assert.equal((await request('faculty', { batch_id: 1, category: '' })).status, 200);
    assert.deepEqual(writes.at(-1), { category: null });
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.Batch.findOne = saved.batch; db.Student.findOne = saved.student; db.Student.count = saved.count; db.Student.findAll = saved.all; reportsRepository.options = saved.options;
  }
});
