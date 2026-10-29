'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/models');
const service = require('../services/reportsService');
const repository = require('../repositories/reportsRepository');
after(() => db.sequelize.close());

test('report student options use bounded, trimmed, escaped partial USN/name search without losing batch scope', async () => {
  const batch = repository.batch, options = repository.options;
  const query = db.sequelize.query;
  const calls = [];
  repository.batch = async id => ({ batch_id: id });
  db.sequelize.query = async (sql, settings) => { calls.push({ sql, settings }); return []; };
  try {
    for (const search of [' 1mv25mc ', ' Ravi ', "%' OR 1=1 --_", '']) {
      await service.getOptions('students', { batch_id: '1', search });
      const { sql, settings } = calls.at(-1);
      assert.match(sql, /batch_id = :batch_id AND deleted_at IS NULL/);
      assert.equal(settings.replacements.batch_id, 1);
      if (search.trim()) {
        assert.match(sql, /usn LIKE :studentSearch OR student_name LIKE :studentSearch/);
        assert.equal(settings.replacements.studentSearch, '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%');
      } else assert.doesNotMatch(sql, /studentSearch/);
      assert.match(sql, /ORDER BY usn, student_id/);
    }
    for (const search of [['Ravi'], {}, 'x'.repeat(101), 'bad\u0000text']) {
      await assert.rejects(service.getOptions('students', { batch_id: '1', search }), error => error.status === 400);
    }
    await service.getOptions('students', { batch_id: '2', search: 'Ravi' });
    assert.equal(calls.at(-1).settings.replacements.batch_id, 2);
  } finally { repository.batch = batch; repository.options = options; db.sequelize.query = query; }
});

test('searched report options retain authentication and staff-only authorization', async () => {
  const express = require('express');
  const saved = service.getOptions;
  service.getOptions = async (scope, filters) => { assert.equal(scope, 'students'); assert.equal(filters.search, 'Ravi'); return []; };
  const app = express();
  app.use((req, res, next) => { req.session = req.headers['x-test-role'] ? { adminId: 1, role: req.headers['x-test-role'] } : {}; if (req.session.adminId) req.account = { admin_id: 1, username: 'Search fixture', role: req.session.role }; next(); });
  app.use('/reports', require('../routes/reportsRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/reports/api/batches/1/students?search=Ravi';
  try {
    assert.equal((await fetch(url, { headers: { Accept: 'application/json' } })).status, 401);
    for (const role of ['admin', 'faculty', 'student']) assert.equal((await fetch(url, { headers: { 'x-test-role': role } })).status, role === 'student' ? 403 : 200);
  } finally { service.getOptions = saved; await new Promise(resolve => server.close(resolve)); }
});

test('read-only MySQL report student options match partial/case/name text and exclude unrelated batches', { skip: process.env.REPORTS_DB_TEST !== '1' }, async () => {
  const batches = await service.getOptions('batches');
  for (const batch of batches) {
    const students = await service.getOptions('students', { batch_id: String(batch.batch_id) });
    if (!students.length) continue;
    const student = students[0];
    for (const search of [student.usn.toLowerCase().slice(0, -2), student.student_name.split(' ')[0].toLowerCase()]) {
      const matches = await service.getOptions('students', { batch_id: String(batch.batch_id), search });
      assert.ok(matches.some(row => String(row.student_id) === String(student.student_id)));
      assert.ok(matches.every(row => (row.usn + ' ' + row.student_name).toLowerCase().includes(search)));
    }
    assert.equal((await service.getOptions('students', { batch_id: String(batch.batch_id), search: 'NoSuchStudent-1927381' })).length, 0);
    const literal = await service.getOptions('students', { batch_id: String(batch.batch_id), search: '%' });
    assert.ok(literal.every(row => (row.usn + row.student_name).includes('%')));
    break;
  }
});
