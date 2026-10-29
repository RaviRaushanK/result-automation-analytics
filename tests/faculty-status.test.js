'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../database/models');
after(() => db.sequelize.close());

test('administrator can deactivate/reactivate faculty with CSRF, stale-state protection and preserved history', async () => {
  const express = require('express'), layouts = require('express-ejs-layouts');
  const token = 'a'.repeat(64), writes = [], transactions = [];
  const historicalAssignments = [{ subject_id: 30, faculty_id: 10 }];
  const originalHistory = JSON.stringify(historicalAssignments);
  const faculty = [
    { faculty_id: 10, faculty_name: 'Test Faculty', faculty_code: 'FAC10', status: 'active', deleted_at: null },
    { faculty_id: 11, faculty_name: 'Former Faculty', faculty_code: 'FAC11', status: 'inactive', deleted_at: null },
    { faculty_id: 12, faculty_name: 'Deleted Faculty', faculty_code: 'FAC12', status: 'active', deleted_at: new Date() },
  ];
  const users = [
    { admin_id: 1, username: 'admin', role: 'admin', status: 'active', deleted_at: null },
    { admin_id: 2, username: 'faculty', role: 'faculty', status: 'active', faculty_id: 10, deleted_at: null, password_hash: await bcrypt.hash('test-password', 4) },
    { admin_id: 3, username: 'suspended', role: 'admin', status: 'inactive', deleted_at: null },
  ];
  let blockedActor = false;
  const saved = { facultyFind: db.Faculty.findOne, facultyAll: db.Faculty.findAll, userFind: db.AdminUser.findOne, userUpdate: db.AdminUser.update, transaction: db.sequelize.transaction };
  function matches(row, where) { return Object.entries(where).every(([key, value]) => value === null ? row[key] == null : String(row[key]) === String(value)); }
  function select(row, attributes) { return attributes ? Object.fromEntries(attributes.map(key => [key, row[key]])) : { ...row }; }
  db.AdminUser.findOne = async options => {
    if (options.lock) { assert.equal(options.lock, 'UPDATE'); if (blockedActor) return null; }
    const row = users.find(item => matches(item, options.where)); return row ? select(row, options.attributes) : null;
  };
  db.AdminUser.update = async (values, options) => { assert.deepEqual(Object.keys(values), ['last_login']); Object.assign(users.find(row => matches(row, options.where)), values); return [1]; };
  db.Faculty.findAll = async options => faculty.filter(row => matches(row, options.where)).map(row => select(row, options.attributes));
  db.Faculty.findOne = async options => {
    const row = faculty.find(item => matches(item, options.where)); if (!row) return null;
    if (options.lock) assert.equal(options.lock, 'UPDATE');
    return options.raw ? select(row, options.attributes) : {
      ...row,
      update: async (values, opts) => {
        assert.ok(opts.transaction); assert.deepEqual(Object.keys(values).sort(), ['status', 'updated_at']);
        assert.ok(values.updated_at instanceof Date); Object.assign(row, values); writes.push({ faculty_id: row.faculty_id, status: row.status });
      },
    };
  };
  db.sequelize.transaction = async callback => {
    const snapshot = faculty.map(row => ({ ...row }));
    try { const value = await callback({ LOCK: { UPDATE: 'UPDATE' } }); transactions.push('commit'); return value; }
    catch (error) { faculty.splice(0, faculty.length, ...snapshot); transactions.push('rollback'); throw error; }
  };
  const app = express(); app.set('views', path.join(__dirname, '../views')); app.set('view engine', 'ejs'); app.set('layout', 'layouts/landing'); app.use(layouts);
  app.use(express.json()); app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const id = req.get('x-test-user');
    req.session = id ? { adminId: Number(id), role: 'admin', username: 'Cached role', csrfToken: token } : {};
    res.locals.flash = []; res.locals.breadcrumbItems = []; next();
  });
  app.use(require('../middlewares/userMiddleware')); app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  // These new endpoints also protect themselves when the router is mounted alone.
  app.use('/faculty', require('../routes/facultyRoutes'));
  app.use(require('../routes/authRoutes'));
  app.get('/protected', require('../middlewares/authMiddleware'), (req, res) => res.json({ role: req.user.role }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(origin + url, { redirect: 'manual', ...options, headers: { Accept: 'application/json', ...options.headers } });
  const patch = (id, body, actor = '1', csrf = token) => request('/faculty/api/' + id + '/status', { method: 'PATCH', headers: { 'x-test-user': actor, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const deactivate = { status: 'inactive', expectedStatus: 'active' }, activate = { status: 'active', expectedStatus: 'inactive' };
  try {
    for (const endpoint of ['/faculty/api/registry', '/faculty/api/10/status']) {
      const options = endpoint.endsWith('/status') ? { method: 'PATCH' } : {};
      assert.equal((await request(endpoint, options)).status, 401);
      for (const id of ['2', '3']) assert.equal((await request(endpoint, { ...options, headers: { 'x-test-user': id } })).status, 403);
    }
    const registry = await request('/faculty/api/registry', { headers: { 'x-test-user': '1' } });
    assert.deepEqual((await registry.json()).data.map(row => row.status), ['active', 'inactive']);
    assert.equal((await request('/protected', { headers: { 'x-test-user': '2' } })).status, 200);
    assert.equal((await patch(10, deactivate, '1', '')).status, 403);
    for (const invalid of [{ ...deactivate, status: 'deleted' }, { status: 'inactive' }, { ...deactivate, role: 'admin' }, { ...deactivate, adminId: 2 }, { ...deactivate, faculty_id: 11 }]) assert.equal((await patch(10, invalid)).status, 400);
    for (const id of ['0', 'invalid', '9223372036854775808']) assert.equal((await patch(id, deactivate)).status, 400);
    for (const id of ['12', '999']) assert.equal((await patch(id, deactivate)).status, 404);
    blockedActor = true; assert.equal((await patch(10, deactivate)).status, 403); blockedActor = false;
    assert.equal(writes.length, 0);
    assert.equal((await patch(10, deactivate)).status, 200);
    assert.equal(faculty[0].status, 'inactive'); assert.equal(users[1].status, 'active', 'Independent account status stays unchanged');
    assert.equal((await request('/protected', { headers: { 'x-test-user': '2' } })).status, 403, 'An existing session is blocked on its next request');
    const login = () => request('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'faculty', password: 'test-password' }) });
    assert.equal((await login()).status, 403);
    assert.equal((await patch(10, deactivate)).status, 409, 'A stale status toggle cannot overwrite current state');
    assert.deepEqual((await (await request('/faculty/api', { headers: { 'x-test-user': '1' } })).json()).data, [], 'Inactive and deleted faculty are excluded from assignment choices');
    assert.equal((await patch(10, activate)).status, 200);
    assert.equal((await request('/protected', { headers: { 'x-test-user': '2' } })).status, 200);
    assert.equal((await login()).status, 302);
    users[1].status = 'inactive';
    assert.equal((await request('/protected', { headers: { 'x-test-user': '2' } })).status, 403, 'Reactivating faculty does not override a suspended login account');
    assert.equal(JSON.stringify(historicalAssignments), originalHistory);
    assert.deepEqual(writes, [{ faculty_id: 10, status: 'inactive' }, { faculty_id: 10, status: 'active' }]);
    assert.ok(transactions.includes('rollback')); assert.ok(transactions.includes('commit'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.Faculty.findOne = saved.facultyFind; db.Faculty.findAll = saved.facultyAll; db.AdminUser.findOne = saved.userFind; db.AdminUser.update = saved.userUpdate; db.sequelize.transaction = saved.transaction;
  }
});
