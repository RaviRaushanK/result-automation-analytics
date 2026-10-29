'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Op } = require('sequelize');

function load(file, dependencies) {
  const context = { module: { exports: {} }, console, URLSearchParams,
    require: name => dependencies[name] || require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return context.module.exports;
}
function fixture() {
  const records = Array.from({ length: 537 }, (_, index) => ({ student_id: index + 1, batch_id: index % 2 + 1,
    usn: 'TEST' + String(index + 1).padStart(4, '0'), student_name: index === 0 ? 'Ravi Kumar' : 'Student ' + index,
    email: index === 0 ? 'ravi@gmail.com' : 'student' + index + '@gmail.com',
    category: index % 3 ? 'MGT' : 'PGCET', status: index % 4 ? 'active' : 'inactive',
    Batch: { batch_id: index % 2 + 1, batch_name: index % 2 ? '2026-2028' : '2025-2027' }, deleted_at: null }));
  records.push({ ...records[0], student_id: 999, usn: 'DELETED', deleted_at: new Date() });
  const calls = [];
  function matches(record, where) {
    return Reflect.ownKeys(where).every(key => {
      if (key === Op.or) return where[key].some(condition => matches(record, condition));
      const condition = where[key];
      if (typeof condition === 'object' && condition !== null) {
        if (condition[Op.ne] !== undefined) return record[key] != null && record[key] !== condition[Op.ne];
        if (condition[Op.like]) {
          const pattern = condition[Op.like].slice(1, -1).replace(/\\([\\%_])/g, '$1');
          return String(record[key] || '').toLowerCase().includes(pattern.toLowerCase());
        }
      }
      return String(record[key]) === String(condition);
    });
  }
  function selected(options) {
    assert.notEqual(options.paranoid, false);
    return records.filter(record => !record.deleted_at && matches(record, options.where));
  }
  const models = {
    Batch: { findOne: async () => ({ batch_id: 2 }) },
    Result: { findAll: async options => {
      assert.deepEqual(Object.keys(options.where), ['student_id']);
      return options.where.student_id[Op.in].some(id => String(id) === '1') ? [{ student_id: '1' }] : [];
    } },
    Student: {
      count: async options => { calls.push({ type: 'count', options }); const rows = selected(options); return options.distinct ? new Set(rows.map(row => row.category)).size : rows.length; },
      findAll: async options => { calls.push({ type: 'rows', options }); return selected(options).sort((a, b) => a.usn.localeCompare(b.usn) || a.student_id - b.student_id).slice(options.offset, options.offset + options.limit); }
    }
  };
  const repository = load('repositories/studentDirectoryRepository.js', { '../database/models': models });
  const service = load('services/studentDirectoryService.js', { '../repositories/studentDirectoryRepository': repository });
  return { records, calls, service, models };
}

test('USN, partial USN, name and email use trimmed case-insensitive contains search across batches', async () => {
  const { service } = fixture();
  for (const search of [' TEST0001 ', 'test0001', 'RAVI KUMAR', 'ravi@GMAIL.com']) {
    const result = await service.list({ batch_id: 'all', search });
    assert.equal(result.pagination.totalRows, 1, search);
    assert.equal(result.rows[0].student_id, 1);
  }
  assert.equal((await service.list({ batch_id: 'all', search: 'TEST00' })).pagination.totalRows, 99);
  assert.equal((await service.list({ batch_id: '2', search: 'TEST0001' })).pagination.totalRows, 0);
  assert.equal((await service.list({ search: 'TEST0001' })).filters.batch_id, '2');
});

test('batch, category, status and search filters combine; soft-deleted rows stay excluded', async () => {
  const { service, records } = fixture();
  const query = { batch_id: 'all', category: 'PGCET', status: 'ACTIVE', search: 'student', pageSize: '100' };
  const result = await service.list(query);
  const expected = records.filter(row => !row.deleted_at && row.category === 'PGCET' && row.status === 'active' && row.student_name.toLowerCase().includes('student'));
  assert.equal(result.pagination.totalRows, expected.length);
  assert.ok(result.rows.every(row => row.category === 'PGCET' && row.status === 'active'));
  assert.equal((await service.list({ batch_id: 'all', search: 'DELETED' })).pagination.totalRows, 0);
  assert.equal((await service.list({ batch_id: 'all', status: 'inactive' })).pagination.totalRows, 135);
});

test('database COUNT, LIMIT and OFFSET preserve deterministic pages beyond 500 matches', async () => {
  const { service, calls } = fixture();
  const first = await service.list({ batch_id: 'all' });
  assert.deepEqual(JSON.parse(JSON.stringify(first.pagination)), { page: 1, pageSize: 25, totalRows: 537, totalPages: 22 });
  assert.equal(first.rows.length, 25);
  const last = await service.list({ batch_id: 'all', page: '999' });
  assert.equal(last.pagination.page, 22);
  assert.equal(last.rows.length, 12);
  assert.equal(last.rows.at(-1).student_id, 537);
  const query = calls.filter(call => call.type === 'rows').at(-1).options;
  assert.equal(query.limit, 25); assert.equal(query.offset, 525);
  assert.equal(JSON.stringify(query.order), JSON.stringify([['usn', 'ASC'], ['student_id', 'ASC']]));
  assert.equal(query.include.length, 1);
  assert.equal(query.attributes.includes('student_uuid'), false);
  const filtered = await service.list({ batch_id: '1', category: 'MGT', status: 'active', search: 'TEST', page: '2', pageSize: '50' });
  assert.equal(filtered.pagination.page, 2);
  assert.ok(filtered.rows.every(row => row.batch_id === 1 && row.category === 'MGT' && row.status === 'active'));
  assert.equal((await service.list({ batch_id: 'all', search: 'missing', page: '8' })).pagination.page, 1);
});

test('query validation bounds values, escapes wildcard text and never concatenates raw SQL', async () => {
  const { service, calls } = fixture();
  for (const query of [{ search: ['x'] }, { search: 'x'.repeat(101) }, { batch_id: '1 OR 1=1' }, { page: '-1' }, { page: '1.5' }, { pageSize: '500' }, { status: 'deleted' }]) {
    await assert.rejects(service.list(query), error => error.status === 400);
  }
  await service.list({ batch_id: 'all', search: "%' OR 1=1 --_" });
  assert.equal(calls.at(-1).options.where[Op.or][0].usn[Op.like], "%\\%' OR 1=1 --\\_%");
});

test('batch-scoped cards use database aggregates, not full student downloads', async () => {
  const { service, calls } = fixture();
  const all = await service.stats({ batch_id: 'all' });
  assert.equal(all.total, 537); assert.equal(all.active, 402); assert.equal(all.inactive, 135); assert.equal(all.categories, 2);
  assert.ok(calls.every(call => call.type === 'count'));
});

test('directory routes require administrator access and deny faculty/student/unknown roles on every endpoint', async () => {
  const express = require('express');
  const directory = require('../services/studentDirectoryService');
  const original = { list: directory.list, stats: directory.stats };
  const { Student, Batch } = require('../database/models');
  const studentMethods = Object.fromEntries(['findByPk', 'findOne', 'create', 'destroy'].map(name => [name, Student[name]]));
  const batchLookup = Batch.findByPk;
  const mutations = [];
  const person = { student_id: 1, batch_id: 1, usn: 'TEST001', student_name: 'Test Student', email: 'test@gmail.com', category: 'PGCET', status: 'active', update: async value => mutations.push({ type: 'update', value }) };
  Student.findByPk = async () => person;
  Student.findOne = async () => null;
  Student.create = async value => { mutations.push({ type: 'create', value }); return value; };
  Student.destroy = async options => { assert.equal(options.force, undefined); assert.equal(String(options.where.student_id), '1'); mutations.push({ type: 'delete' }); return 1; };
  Batch.findByPk = async () => ({ batch_id: 1, batch_name: 'Test Batch' });
  directory.list = fixture().service.list;
  directory.stats = fixture().service.stats;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { const role = req.headers['x-test-role']; req.session = role ? { adminId: 1, role } : {}; req.user = role ? { role } : null; if (role) req.account = { admin_id: 1, username: 'Directory fixture', role }; next(); });
  app.use('/students', require('../routes/studentRoutes'));
  app.use('/reports', require('../routes/reportsRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/students/api/list', { headers: { Accept: 'application/json' }, redirect: 'manual' })).status, 401);
    const anonymous = await fetch(base + '/students', { redirect: 'manual' });
    assert.equal(anonymous.status, 302); assert.equal(anonymous.headers.get('location'), '/login');
    for (const role of ['faculty', 'student', 'guest', 'invalid']) {
      for (const [method, url] of [['GET', '/'], ['GET', '/search?q=Ravi'], ['GET', '/api/list?batch_id=all'], ['GET', '/api/stats'], ['GET', '/api/categories'], ['GET', '/api/1'], ['GET', '/api/999'], ['POST', '/api'], ['PUT', '/api/1'], ['DELETE', '/api/1'], ['POST', '/api/import/preview'], ['POST', '/api/import/confirm']]) {
        const response = await fetch(base + '/students' + url, { method, headers: { 'x-test-role': role }, redirect: 'manual' });
        assert.equal(response.status, 403, role + ' ' + method + url);
      }
    }
    assert.equal((await fetch(base + '/reports/student?student_id=999&batch_id=all', { headers: { 'x-test-role': 'student' } })).status, 403);
    for (const role of ['admin']) {
      const response = await fetch(base + '/students/api/list?batch_id=all&page=2', { headers: { 'x-test-role': role } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).pagination.totalRows, 537);
      const redirect = await fetch(base + '/students/search?q=Ravi&batch_id=all&status=active', { headers: { 'x-test-role': role }, redirect: 'manual' });
      assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/students?search=Ravi&batch_id=all&status=active');
      for (const [method, endpoint] of [['GET', '/api/1'], ['POST', '/api'], ['PUT', '/api/1'], ['DELETE', '/api/1']]) {
        const result = await fetch(base + '/students' + endpoint, { method, headers: { 'x-test-role': role, 'Content-Type': 'application/json' },
          ...(method === 'POST' || method === 'PUT' ? { body: JSON.stringify(person) } : {}) });
        assert.ok(result.ok, role + ' ' + method + endpoint);
      }
      const confirmed = await fetch(base + '/students/api/import/confirm', { method: 'POST', headers: { 'x-test-role': role, 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_id: '1', status: 'active', rows: [{ ...person, valid: true }] }) });
      assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).data.imported, 1);
    }
    assert.equal(mutations.length, 4);
    directory.list = async () => { throw new Error('secret SQL stack database credentials'); };
    const failure = await fetch(base + '/students/api/list', { headers: { 'x-test-role': 'admin' } });
    assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /secret|credentials|stack/);
  } finally { Object.assign(directory, original); Object.assign(Student, studentMethods); Batch.findByPk = batchLookup; await new Promise(resolve => server.close(resolve)); }
});

test('sidebar keeps one directory destination and no student self-service mapping is invented', () => {
  const menu = require('../config/sidebar.json').menu;
  const children = menu.find(item => item.label === 'Student Repository').children;
  assert.equal(children.length, 1); assert.equal(children[0].route, '/students');
  assert.deepEqual(children[0].roles, ['admin']);
  const res = { locals: {} };
  require('../middlewares/menuMiddleware')({ user: { role: 'student' }, originalUrl: '/dashboard' }, res, () => {});
  assert.equal(res.locals.sidebarMenu.some(item => item.label === 'Student Repository'), false);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../database/models/AdminUser.js'), 'utf8'), /student_id/);
});

test('existing Student Result links carry authoritative batch and student identifiers', () => {
  const ejs = require('ejs');
  const { records } = fixture();
  const html = ejs.renderFile;
  assert.equal(typeof html, 'function');
  const rendered = ejs.render(fs.readFileSync(path.join(__dirname, '../views/students/partials/rows.ejs'), 'utf8'), {
    rows: [{ ...records[0], has_results: true }], filters: { search: '' }, pagination: { page: 2, pageSize: 25 }
  });
  assert.match(rendered, /\/reports\/student\?batch_id=1&amp;student_id=1/);
  assert.match(rendered, /View Results/); assert.match(rendered, /data-act="edit"/); assert.match(rendered, /data-act="delete"/);
  assert.match(rendered, /<td>26<\/td>/);
});

test('any saved result enables View Results without requiring later semesters or a passing outcome', async () => {
  const { service } = fixture();
  const listing = await service.list({ batch_id: 'all' });
  assert.equal(listing.rows[0].has_results, true);
  assert.ok(listing.rows.slice(1).every(row => row.has_results === false));
  assert.equal(JSON.parse(JSON.stringify(listing.rows[0])).has_results, true);
});

test('initial and refreshed student rows disable navigation only when no saved results exist', () => {
  const ejs = require('ejs');
  const template = fs.readFileSync(path.join(__dirname, '../views/students/partials/rows.ejs'), 'utf8');
  const browser = fs.readFileSync(path.join(__dirname, '../public/js/students.js'), 'utf8');
  const rowFunction = browser.slice(browser.indexOf('  function rowHtml('), browser.indexOf('  function parameters('));
  const context = { pagination: { page: 1, pageSize: 25 }, URLSearchParams,
    esc: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'), batchName: () => 'MCA' };
  vm.runInNewContext(rowFunction, context);
  for (const has_results of [false, true]) {
    const student = { student_id: 1, batch_id: 1, usn: 'TEST001', student_name: 'Test Student', status: 'active', has_results };
    const initial = ejs.render(template, { rows: [student], filters: {}, pagination: context.pagination });
    const refreshed = context.rowHtml(student, 0);
    for (const html of [initial, refreshed]) {
      if (has_results) {
        assert.match(html, /<a[^>]+href="\/reports\/student\?batch_id=1&amp;student_id=1"/);
        assert.doesNotMatch(html, /aria-disabled="true"/);
      } else {
        assert.match(html, /<button[^>]+students-results-link[^>]+disabled aria-disabled="true"/);
        assert.match(html, /No results uploaded/);
        assert.doesNotMatch(html, /href="\/reports\/student/);
      }
      assert.match(html, /data-act="edit"/);
      assert.match(html, /data-act="delete"/);
    }
  }
});

test('read-only MySQL search agrees with current collation and excludes deleted students', { skip: process.env.REPORTS_DB_TEST !== '1' }, async () => {
  const { Student, sequelize } = require('../database/models');
  const service = require('../services/studentDirectoryService');
  try {
    const student = await Student.findOne({ order: [['usn', 'ASC']] });
    if (!student) return;
    for (const search of [student.usn.toLowerCase(), student.usn.slice(0, Math.min(8, student.usn.length)), student.student_name, student.email]) {
      if (!search) continue;
      const result = await service.list({ batch_id: 'all', search, pageSize: '100' });
      assert.ok(result.pagination.totalRows > 0);
      assert.ok(result.rows.every(row => !row.deleted_at));
    }
    assert.ok((await service.list({ batch_id: String(student.batch_id), search: student.usn })).rows.some(row => String(row.student_id) === String(student.student_id)));
    const query = await service.list({ batch_id: 'all' });
    assert.equal(query.pagination.totalRows, await Student.count());
    assert.ok(query.rows.length <= 25);
    const literal = await service.list({ batch_id: 'all', search: '%' });
    assert.ok(literal.rows.every(row => [row.usn, row.student_name, row.email].some(value => String(value || '').includes('%'))));
  } finally { await sequelize.close(); }
});
