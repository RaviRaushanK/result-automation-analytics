'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const db = require('../database/models');
const accounts = require('../repositories/settingsRepository');
after(() => db.sequelize.close());

test('current account requires an active, undeleted faculty record and returns its identity', async () => {
  const saved = { account: db.AdminUser.findOne, faculty: db.Faculty.findOne };
  let row = { admin_id: 1, role: 'faculty', faculty_id: '42' };
  let faculty = { faculty_code: 'FAC42', faculty_name: 'Faculty member' };
  db.AdminUser.findOne = async query => {
    assert.equal(query.where.status, 'active'); assert.equal(query.where.deleted_at, null);
    return row && { ...row };
  };
  db.Faculty.findOne = async query => {
    assert.deepEqual(query.where, { faculty_id: '42', status: 'active', deleted_at: null }); return faculty;
  };
  try {
    assert.equal((await accounts.account(1)).faculty_code, 'FAC42');
    faculty = null; assert.equal(await accounts.account(1), null);
    row.faculty_id = null; assert.equal(await accounts.account(1), null);
    row = null; assert.equal(await accounts.account(1), null);
    row = { admin_id: 1, role: 'admin', faculty_id: null }; assert.equal((await accounts.account(1)).role, 'admin');
    row.role = 'unknown'; assert.equal(await accounts.account(1), null);
  } finally { db.AdminUser.findOne = saved.account; db.Faculty.findOne = saved.faculty; }
});

test('application enforces faculty restrictions on direct URLs and refreshes stale session roles', async () => {
  const saved = accounts.account;
  const registration = require('../services/registrationService');
  const savedFaculty = registration.availableFaculty;
  const savedBatches = db.Batch.findAll, savedSessions = db.ExamSession.findAll;
  registration.availableFaculty = async () => [];
  db.Batch.findAll = async () => [];
  db.ExamSession.findAll = async () => [];
  let account = { admin_id: 1, username: 'Faculty fixture', role: 'faculty', faculty_id: 42, faculty_name: 'Faculty member', faculty_code: 'FAC42' };
  accounts.account = async () => account;
  const appPath = path.join(__dirname, '../app.js');
  const realRequire = createRequire(appPath);
  const injectedRequire = name => {
    if (name === './config/db') return {};
    if (name === './config/session') return {};
    if (name === 'express-session') return () => (req, res, next) => {
      // Deliberately stale admin claim: authority must come from accounts.account.
      req.session = { adminId: 1, role: 'admin', username: 'Old session', touch() {}, save(callback) { callback(); } };
      next();
    };
    return realRequire(name);
  };
  const appModule = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(appPath, 'utf8'))(injectedRequire, appModule, appModule.exports, path.dirname(appPath));
  const server = appModule.exports.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(origin + url, { redirect: 'manual', headers: { Accept: 'application/json' }, ...options });
  try {
    for (const url of ['/batches', '/batches/api', '/subjects', '/students', '/faculty/api', '/results/upload', '/results/logs', '/revaluation/start', '/exam-sessions', '/sessions', '/uploads/results/example.pdf', '/uploads/temp/example.pdf', '/invitations', '/settings?section=institution', '/settings?section=system']) {
      assert.equal((await request(url)).status, 403, url);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      for (const url of ['/batches/api', '/subjects/api', '/students/api', '/faculty/api', '/results/upload', '/revaluation/start', '/exam-sessions/api', '/invitations', '/settings/institution', '/settings/logo']) {
        const response = await request(url, { method });
        // Unimplemented verbs may return 404, but cannot reach a mutation handler.
        assert.ok([403, 404].includes(response.status), method + ' ' + url);
      }
    }
    for (const section of ['account', 'security', 'appearance', 'academic-policy']) {
      const response = await request('/settings?section=' + section);
      assert.equal(response.status, 200, section);
      const html = await response.text();
      for (const link of ['/batches', '/subjects', '/students', '/results/upload', '/invitations']) assert.ok(!html.includes(`href="${link}"`), link);
      for (const label of ['Academic Management', 'Student Repository', 'Result Management']) assert.ok(!html.includes(label), label);
      if (section === 'account') { assert.match(html, /Faculty member/); assert.match(html, /FAC42/); }
    }
    assert.equal((await request('/dashboard')).status, 200);
    assert.equal((await request('/reports')).status, 200);
    assert.equal((await request('/analytics/overview')).status, 200);
    assert.equal((await request('/reports/api/class')).status, 400);
    // A newly revoked account cannot continue even with its previous session.
    account = null;
    for (const url of ['/dashboard', '/analytics/api/overview', '/reports/class/export.csv', '/settings', '/account-security']) assert.equal((await request(url)).status, 403, url);
    account = { admin_id: 1, username: 'Administrator', role: 'admin' };
    assert.equal((await request('/invitations')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve)); accounts.account = saved;
    registration.availableFaculty = savedFaculty;
    db.Batch.findAll = savedBatches; db.ExamSession.findAll = savedSessions;
  }
});

test('migration preserves accounts, adds unique faculty linkage, and revokes legacy pending invitations', async () => {
  const migration = require('../migrations/20261029100000-faculty-account-access');
  const columns = [], queries = [];
  await migration.up({
    describeTable: async () => ({}),
    changeColumn: async (table, column, options) => { assert.equal(table, 'admin_users'); assert.equal(column, 'role'); assert.deepEqual(options.type.values, ['admin', 'faculty']); },
    addColumn: async (...args) => columns.push(args),
    sequelize: { query: async sql => queries.push(sql) }
  }, require('sequelize'));
  assert.equal(columns.length, 2);
  assert.equal(columns[0][2].unique, true);
  for (const [, column, options] of columns) { assert.equal(column, 'faculty_id'); assert.equal(options.references.model, 'faculty'); }
  assert.equal(queries.length, 1);
  assert.match(queries[0], /faculty_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL/);
  assert.match(queries[0], /registration = NULL/);
});

test('login rejects disabled faculty linkage and redirects faculty away from saved management destinations', async () => {
  const controller = require('../controllers/authController');
  const saved = { find: db.AdminUser.findOne, update: db.AdminUser.update, account: accounts.account };
  const account = { admin_id: 1, username: 'faculty-login', role: 'faculty', status: 'active', password_hash: await require('bcryptjs').hash('test-password', 4) };
  db.AdminUser.findOne = async () => account;
  db.AdminUser.update = async () => [1];
  let available = false;
  accounts.account = async () => available ? account : null;
  function response() { return { code: 200, set() { return this; }, status(code) { this.code = code; return this; }, render(view, values) { this.view = view; this.values = values; }, redirect(url) { this.url = url; } }; }
  try {
    const denied = { body: { username: account.username, password: 'test-password' }, session: {}, accepts: () => true };
    const deniedResponse = response(); await controller.login(denied, deniedResponse);
    assert.equal(deniedResponse.code, 403); assert.equal(denied.session.adminId, undefined);
    available = true;
    for (const [returnTo, expected] of [['/results/upload', '/dashboard'], ['/reports/class', '/reports/class']]) {
      const req = { body: denied.body, session: { returnTo } }, res = response();
      await controller.login(req, res);
      assert.equal(res.url, expected); assert.equal(req.session.role, 'faculty');
    }
  } finally { db.AdminUser.findOne = saved.find; db.AdminUser.update = saved.update; accounts.account = saved.account; }
});
