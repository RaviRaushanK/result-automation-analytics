'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const db = require('../database/models');
const repository = require('../repositories/reportsRepository');
const service = require('../services/reportsService');
const router = require('../routes/reportsRoutes');

after(() => db.sequelize.close());
const base = { batch_id: '1', semester: '1', session_id: '1' };

test('strict filter validation and Effective default', () => {
  assert.equal(service.normalize('class', base).mode, 'effective');
  for (const value of ['0', '-1', '1 OR 1=1', '1.5', ['1'], {}, '9007199254740992']) {
    assert.throws(() => service.normalize('class', { ...base, batch_id: value }), /Invalid Batch/);
  }
  for (const [key, value] of [['mode', 'final'], ['pageSize', '1000'], ['page', '-1'], ['exam_type', 'OTHER'], ['result_status', 'unknown'], ['revaluation_status', 'accepted'], ['semester', ['1']]]) {
    assert.throws(() => service.normalize('class', { ...base, [key]: value }));
  }
  assert.throws(() => service.normalize('student', { ...base, student_id: '1', result_status: 'pass' }), /Unsupported/);
});

test('CSV escaping, spreadsheet safety, and nullable data', () => {
  assert.equal(service.csvCell('a,b'), '"a,b"');
  assert.equal(service.csvCell('a"b\nc'), '"a""b\nc"');
  assert.equal(service.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(service.csvCell(' @SUM(1)'), "' @SUM(1)");
  assert.equal(service.csvCell('-12'), '-12');
  assert.equal(service.display('sgpa', null), '-');
  assert.equal(service.display('grade', null), '-');
  assert.equal(service.display('is_effective', null), '-');
});

test('page, API and export roles are enforced server-side', async () => {
  const app = express();
  app.use((req, res, next) => {
    req.session = req.headers['x-test-role'] ? { adminId: 1, role: req.headers['x-test-role'] } : {};
    next();
  });
  app.use('/reports', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const endpoint of ['/reports/student', '/reports/api/student', '/reports/student/export.csv', '/reports/student/print']) {
      const anon = await fetch(url + endpoint, { headers: { Accept: 'application/json' }, redirect: 'manual' });
      assert.equal(anon.status, 401);
      const forbidden = await fetch(url + endpoint, { headers: { Accept: 'application/json', 'x-test-role': 'student' } });
      assert.equal(forbidden.status, 403);
    }
    for (const role of ['admin', 'faculty']) {
      const response = await fetch(url + '/reports/api/class', { headers: { Accept: 'application/json', 'x-test-role': role } });
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /Batch is required/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

// MySQL CTEs shadow table names for fixture queries; no rows/tables are written.
const fixture = `WITH
 batches AS (SELECT 1 batch_id, 'Batch A' batch_name, 2024 start_year, 2026 end_year, NULL deleted_at
   UNION ALL SELECT 2, 'Batch B', 2025, 2027, NULL),
 result_sessions AS (SELECT 1 session_id, 1 batch_id, '1' semester, 'JAN' exam_session, 2026 exam_year
   UNION ALL SELECT 2, 2, '1', 'JUN', 2026),
 students AS (SELECT 1 student_id, 1 batch_id, 'USN1' usn, 'Student One' student_name, NULL deleted_at
   UNION ALL SELECT 2, 1, 'USN2', 'Student Two', NULL
   UNION ALL SELECT 3, 1, 'USN3', 'Deleted', '2026-01-01'
   UNION ALL SELECT 4, 2, 'USN4', 'Other Batch', NULL),
 subjects AS (SELECT 1 subject_id, 1 session_id, 'MCA101' subject_code, 'Subject One' subject_name, 4 credits, 100 max_marks
   UNION ALL SELECT 2, 1, 'MCA102', 'Subject Two', 4, 100
   UNION ALL SELECT 3, 2, 'MCA101', 'Other Session', 4, 100),
 results AS (SELECT 1 result_id, 1 student_id, 1 session_id, 1 attempt_no, 'REGULAR' exam_type, 3.5 sgpa, NULL cgpa, 'fail' result_status, 1 failed_subject_count
   UNION ALL SELECT 2, 1, 1, 2, 'BACKLOG', 6.0, 6.0, 'pass', 0
   UNION ALL SELECT 3, 2, 1, 1, 'REGULAR', NULL, NULL, 'fail', 1
   UNION ALL SELECT 4, 3, 1, 1, 'REGULAR', 9.0, 9.0, 'pass', 0
   UNION ALL SELECT 5, 2, 1, 2, 'REPEAT', NULL, NULL, 'fail', 0
   UNION ALL SELECT 6, 2, 1, 3, 'SUPPLEMENTARY', NULL, NULL, 'fail', 1),
 subject_results AS (SELECT 1 subject_result_id, 1 result_id, 1 subject_id, 30 marks, 'F' grade, 'fail' result_status
   UNION ALL SELECT 2, 1, 2, 70, 'A', 'pass'
   UNION ALL SELECT 3, 2, 1, 65, 'B+', 'pass'
   UNION ALL SELECT 4, 3, 1, 35, NULL, 'fail'
   UNION ALL SELECT 5, 4, 1, 90, 'O', 'pass'
   UNION ALL SELECT 6, 6, 2, 25, 'F', 'fail'),
 revaluation_results AS (SELECT 1 revaluation_id, 1 subject_result_id, 1 revaluation_no, 1 is_effective, 'approved' revaluation_status,
   30 original_marks, 'fail' original_status, 40 revised_marks, 'fail' revised_status, 'F' revised_grade, NULL reviewed_at
   UNION ALL SELECT 2, 1, 2, 1, 'approved', 30, 'fail', 60, 'pass', 'B+', NULL
   UNION ALL SELECT 3, 1, 3, 1, 'pending', 30, 'fail', 99, 'pass', 'O', NULL
   UNION ALL SELECT 4, 1, 4, 1, 'rejected', 30, 'fail', 20, 'fail', 'F', NULL
   UNION ALL SELECT 5, 4, 1, 1, 'pending', 35, 'fail', 80, 'pass', 'A+', NULL
   UNION ALL SELECT 6, 6, 1, 1, 'rejected', 25, 'fail', 85, 'pass', 'A+', NULL
   UNION ALL SELECT 7, 2, 1, 1, 'approved', 70, 'pass', 75, 'pass', 'A', NULL
   UNION ALL SELECT 8, 3, 1, 0, 'approved', 65, 'pass', 10, 'fail', 'F', NULL
   UNION ALL SELECT 9, 3, 2, 1, 'approved', 65, 'pass', 20, 'fail', 'F', NULL)
 `;

test('read-only MySQL fixture integration', { skip: process.env.REPORTS_DB_TEST !== '1' }, async t => {
  const originalQuery = db.sequelize.query.bind(db.sequelize);
  db.sequelize.query = (sql, options) => {
    assert.match(sql.trim(), /^SELECT\b/i);
    return originalQuery(fixture + sql, options);
  };
  try {
    await t.test('original remains unchanged; only highest approved-effective event overlays', async () => {
      const original = await service.getReport('student', { ...base, student_id: '1', attempt_no: '1', mode: 'original' });
      const effective = await service.getReport('student', { ...base, student_id: '1', attempt_no: '1' });
      assert.deepEqual(original.rows.map(r => Number(r.marks)), [30, 70]);
      assert.deepEqual(effective.rows.map(r => Number(r.marks)), [60, 75]);
      assert.equal(effective.rows[0].result_status, 'pass');
      assert.equal(effective.rows[0].grade, 'B+');
      assert.equal(effective.meta.result.result_status, 'fail');
      assert.equal(effective.metrics.some(([label]) => /SGPA|CGPA/.test(label)), false);
      assert.equal(effective.columns.some(c => /internal|external/i.test(c.label)), false);
      assert.equal(original.metrics.find(([label]) => label === 'CGPA')[1], '-');
    });
    await t.test('pending/rejected do not overlay and missing grades remain missing', async () => {
      const pending = await service.getReport('student', { ...base, student_id: '2', attempt_no: '1' });
      assert.equal(Number(pending.rows[0].marks), 35);
      assert.equal(pending.rows[0].result_status, 'fail');
      assert.equal(pending.rows[0].grade, null);
      const rejected = await service.getReport('student', { ...base, student_id: '2', attempt_no: '3' });
      assert.equal(Number(rejected.rows[0].marks), 25);
    });
    await t.test('stored pass-to-fail and marks-only changes are preserved', async () => {
      const original = await service.getReport('student', { ...base, student_id: '1', attempt_no: '2', mode: 'original' });
      const effective = await service.getReport('student', { ...base, student_id: '1', attempt_no: '2' });
      assert.equal(original.rows[0].result_status, 'pass');
      assert.equal(effective.rows[0].result_status, 'fail');
      assert.equal(Number(effective.rows[0].marks), 20);
      const first = await service.getReport('student', { ...base, student_id: '1', attempt_no: '1' });
      assert.equal(first.rows[1].result_status, 'pass');
      assert.equal(Number(first.rows[1].marks), 75);
    });
    await t.test('attempt selection and all exam types; missing outcomes are unavailable', async () => {
      await assert.rejects(service.getReport('student', { ...base, student_id: '1' }), /Select an attempt/);
      const attempts = await service.getOptions('student-results', { ...base, student_id: '1' });
      assert.deepEqual(attempts.map(r => Number(r.attempt_no)), [1, 2]);
      const report = await service.getReport('class', base);
      assert.equal(report.rows.length, 5);
      assert.deepEqual([...new Set(report.rows.map(r => r.exam_type))].sort(), ['BACKLOG', 'REGULAR', 'REPEAT', 'SUPPLEMENTARY']);
      assert.equal(report.rows.find(r => Number(r.result_id) === 5).result_status, null);
      assert.equal(report.metrics.find(([label]) => label === 'Passed')[1], 1);
      assert.equal(report.metrics.find(([label]) => label === 'Students')[1], 2);
      const noSubjects = await service.getReport('student', { ...base, student_id: '2', attempt_no: '2' });
      assert.equal(noSubjects.rows.length, 0);
    });
    await t.test('status filters use selected basis and deleted students are excluded', async () => {
      const effective = await service.getReport('class', { ...base, result_status: 'pass' });
      const original = await service.getReport('class', { ...base, result_status: 'pass', mode: 'original' });
      assert.equal(effective.rows.length, 1);
      assert.equal(original.rows.length, 1);
      assert.equal(Number(effective.rows[0].result_id), 1);
      assert.equal(Number(original.rows[0].result_id), 2);
      const subject = await service.getReport('subject', { ...base, subject_id: '1' });
      assert.equal(subject.rows.length, 3);
      assert.equal(subject.rows.some(r => r.usn === 'USN3'), false);
      assert.equal(subject.metrics.find(([label]) => label === 'Pass Percentage')[1], '33.33%');
      await assert.rejects(service.getReport('student', { ...base, student_id: '3', attempt_no: '1' }), /Student does not belong/);
    });
    await t.test('ledger reports events and actual effective selection', async () => {
      const report = await service.getReport('revaluation', base);
      assert.equal(report.rows.length, 9);
      assert.equal(report.metrics.find(([label]) => label === 'Effective')[1], 3);
      assert.equal(report.rows.filter(r => Number(r.is_effective)).length, 3);
      assert.equal(Number(report.rows.find(r => Number(r.revaluation_id) === 8).is_effective), 0);
      const approved = await service.getReport('revaluation', { ...base, revaluation_status: 'approved' });
      assert.equal(approved.rows.length, 5);
    });
    await t.test('wrong ownership, invalid attempts, empty result, page clamping', async () => {
      await assert.rejects(service.getReport('class', { ...base, session_id: '2' }), /does not belong/);
      await assert.rejects(service.getReport('class', { ...base, semester: '2' }), /does not belong/);
      await assert.rejects(service.getReport('subject', { ...base, subject_id: '3' }), /does not belong/);
      await assert.rejects(service.getReport('student', { ...base, student_id: '4', attempt_no: '1' }), /does not belong/);
      await assert.rejects(service.getReport('student', { ...base, student_id: '1', attempt_no: '99' }), /not found/);
      const empty = await service.getReport('class', { batch_id: '2', semester: '1', session_id: '2' });
      assert.equal(empty.pagination.totalRows, 0);
      assert.equal(empty.rows.length, 0);
      const paged = await service.getReport('class', { ...base, page: '999' });
      assert.equal(paged.pagination.page, 1);
    });
    await t.test('EJS pages, APIs, full CSV and full print through protected router', async () => {
      const app = express();
      app.set('view engine', 'ejs');
      app.set('views', path.join(__dirname, '../views'));
      app.use((req, res, next) => { req.session = { adminId: 1, role: 'faculty' }; next(); });
      app.use('/reports', router);
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        for (const type of service.TYPES) {
          const query = new URLSearchParams({ ...base, ...(type === 'student' ? { student_id: '1', attempt_no: '1' } : {}), ...(type === 'subject' ? { subject_id: '1' } : {}) });
          const page = await fetch(`${url}/reports/${type}`);
          assert.equal(page.status, 200);
          const html = await page.text();
          assert.match(html, /reports-filters/);
          assert.doesNotMatch(html, /name="department_id"|name="exam_year"/);
          const api = await fetch(`${url}/reports/api/${type}?${query}`);
          assert.equal(api.status, 200);
          const csv = await fetch(`${url}/reports/${type}/export.csv?${query}`);
          assert.equal(csv.status, 200);
          assert.match(csv.headers.get('content-type'), /text\/csv/);
          assert.match(await csv.text(), /USN1|Subject One/);
          const print = await fetch(`${url}/reports/${type}/print?${query}`);
          assert.equal(print.status, 200);
          assert.match(await print.text(), /reports-print/);
        }
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
  } finally { db.sequelize.query = originalQuery; }
});

test('full export bypasses preview pagination and reads in chunks', async () => {
  const saved = repository.rows;
  const calls = [];
  repository.rows = async (type, filters, limit, offset) => {
    calls.push({ limit, offset });
    return Array.from({ length: Math.max(0, Math.min(limit, 1050 - offset)) }, (_, i) => ({ marks: offset + i }));
  };
  try {
    const rows = [];
    for await (const row of service.fullRows({ type: 'class', filters: base, pagination: { pageSize: 25 } })) rows.push(row);
    assert.equal(rows.length, 1050);
    assert.deepEqual(calls, [{ limit: 1000, offset: 0 }, { limit: 1000, offset: 1000 }]);
  } finally { repository.rows = saved; }
});
