'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { normalize } = require('../services/examSessionParameters');

test('legacy academic ID aliases normalize to exam_session_id and conflicting values are rejected', () => {
  for (const key of ['session_id', 'sessionId', 'examSessionId', 'session']) {
    assert.deepEqual(normalize({ [key]: '2', batch_id: '1' }), { exam_session_id: '2', batch_id: '1' });
    assert.equal(normalize({ [key]: '2', exam_session_id: 2 }).exam_session_id, 2);
    assert.throws(() => normalize({ [key]: '1', exam_session_id: '2' }), error => error.status === 400);
  }
  assert.throws(() => normalize({ session_id: ['1', '2'] }), error => error.status === 400);
});

test('HTTP compatibility preserves auth state, rejects cross-source conflicts and redirects saved links', async t => {
  const express = require('express');
  const app = express();
  const auth = { adminId: 1 };
  app.use(express.json());
  app.use((req, res, next) => { req.session = auth; next(); });
  app.use(require('../middlewares/examSessionParameters'));
  app.use('/sessions', require('../middlewares/legacyExamSessionRedirect'));
  app.all('/exam-sessions', (req, res) => res.json({ query: req.query, body: req.body, authUnchanged: req.session === auth }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const old = await fetch(base + '/sessions?session_id=2', { redirect: 'manual' });
  assert.equal(old.status, 307);
  assert.match(old.headers.get('location'), /^\/exam-sessions\/\?session_id=2$/);
  const response = await (await fetch(base + '/exam-sessions?session_id=2')).json();
  assert.deepEqual(response.query, { exam_session_id: '2' });
  assert.equal(response.authUnchanged, true);
  assert.equal((await fetch(base + '/exam-sessions?session_id=1&exam_session_id=2')).status, 400);
  assert.equal((await fetch(base + '/exam-sessions?session_id=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exam_session_id: 2 }) })).status, 400);
});

test('ExamSession model and associations expose the renamed table/PK/FKs without legacy model aliases', async () => {
  const { Sequelize, DataTypes } = require('sequelize');
  const db = new Sequelize('fixture', 'fixture', 'fixture', { dialect: 'mysql', logging: false });
  try {
    const model = require('../database/models/ExamSession')(db, DataTypes);
    assert.equal(model.name, 'ExamSession');
    assert.equal(model.tableName, 'exam_sessions');
    assert.equal(model.primaryKeyAttribute, 'exam_session_id');
    assert.equal(model.rawAttributes.session_id, undefined);
    for (const name of ['Subject', 'Result', 'ImportLog']) {
      const child = require('../database/models/' + name)(db, DataTypes);
      child.belongsTo(model, { foreignKey: 'exam_session_id' });
      assert.equal(child.associations.ExamSession.foreignKey, 'exam_session_id');
    }
    const index = fs.readFileSync(require.resolve('../database/models'), 'utf8');
    assert.doesNotMatch(index, /ResultSession/);
    assert.match(index, /ExamSession\.hasMany\(Result/);
  } finally { await db.close(); }
});

test('migration refuses ambiguous schemas before issuing any DDL', async () => {
  const migration = require('../migrations/20261023130000-rename-examination-session-domain');
  for (const names of [[], ['exam_sessions', 'result_sessions']]) {
    const calls = [];
    await assert.rejects(migration.up({ sequelize: { query: async sql => { calls.push(sql); return [names.map(TABLE_NAME => ({ TABLE_NAME }))]; } } }), /Ambiguous/);
    assert.equal(calls.length, 1);
  }
});

test('Analytics and Reports accept legacy academic filters and reject contradictory IDs', () => {
  const analytics = require('../services/analyticsService');
  const reports = require('../services/reportsService');
  assert.equal(analytics.normalizeFilters({ session_id: '2' }).exam_session_id, 2);
  assert.throws(() => analytics.normalizeFilters({ session_id: '1', exam_session_id: '2' }), /Conflicting/);
  assert.equal(reports.normalize('student', { batch_id: '1', student_id: '1', session_id: '2' }).exam_session_id, 2);
  assert.throws(() => reports.normalize('student', { batch_id: '1', student_id: '1', session_id: '1', exam_session_id: '2' }), /Conflicting/);
});

test('browser compatibility preserves bookmarked academic filters and leaves login URLs unchanged', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../public/js/exam-session-parameters'), 'utf8');
  for (const pathname of ['/reports/student', '/analytics/students', '/login']) {
    let replaced;
    const window = { location: { pathname, href: 'http://localhost' + pathname + '?batch_id=1&session_id=2#details' },
      history: { state: { existing: true }, replaceState(state, title, url) { replaced = url; assert.equal(state.existing, true); } } };
    vm.runInNewContext(source, { window, URL });
    if (pathname === '/login') assert.equal(replaced, undefined);
    else assert.equal(replaced, pathname + '?batch_id=1&exam_session_id=2#details');
  }
});

test('historical OCR context is normalized on read without rewriting its stored payload', () => {
  const path = require('node:path');
  const vm = require('node:vm');
  const file = require.resolve('../controllers/revaluationController');
  const requireLocal = require('node:module').createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.readContext = safeJson;', {
    module, exports: module.exports, __dirname: path.dirname(file), console,
    require: name => name === '../database/models' ? {} : requireLocal(name),
  });
  const original = { result_id: 7, session_id: 1, attempt_no: 1 };
  const stored = JSON.stringify(original);
  const parsed = module.exports.readContext(stored);
  assert.equal(parsed.exam_session_id, 1);
  assert.equal(parsed.session_id, undefined);
  assert.equal(parsed.result_id, 7);
  assert.equal(JSON.stringify(original), stored);
  assert.equal(Object.keys(module.exports.readContext('{"session_id":1,"exam_session_id":2}')).length, 0);
});

test('Exam Session management and filter labels use the new terminology', async () => {
  const ejs = require('ejs');
  const html = await ejs.renderFile(require.resolve('../views/exam-sessions/index.ejs'), { sessions: [], batches: [] });
  assert.match(html, /Exam Session Management/);
  assert.match(html, /Create New Exam Session/);
  assert.doesNotMatch(html, /Result Session/);
  for (const file of ['../views/results/upload.ejs', '../views/subjects/index.ejs', '../views/faculty/index.ejs']) {
    assert.match(fs.readFileSync(require.resolve(file), 'utf8'), /Exam Session/);
  }
});
