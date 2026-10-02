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
  assert.equal(service.normalize('toppers', base).mode, 'original');
  assert.throws(() => service.normalize('toppers', { ...base, mode: 'effective' }), /Invalid Result view/);
  for (const filter of [{ subject_id: '1' }, { result_status: 'fail' }, { revaluation_status: 'pending' }, { attempt_no: '1' }]) {
    assert.throws(() => service.normalize('toppers', { ...base, ...filter }));
    assert.throws(() => service.normalize('consolidated', { ...base, ...filter }));
    assert.throws(() => service.normalize('result-analysis', { ...base, ...filter }));
  }
  assert.throws(() => service.normalize('result-analysis', { ...base, exam_type: 'REGULAR' }));
  assert.equal(service.normalize('student-progress', { batch_id: '1' }).mode, 'effective');
  assert.throws(() => service.normalize('student-progress', base), /supports Batch/);
  assert.throws(() => service.normalize('consolidated', { ...base, session_id: 'all' }));
  assert.throws(() => service.normalize('consolidated', { ...base, semester: 'all', session_id: '' }));
});

test('CSV escaping, spreadsheet safety, and nullable data', () => {
  assert.equal(service.csvCell('a,b'), '"a,b"');
  assert.equal(service.csvCell('a"b\nc'), '"a""b\nc"');
  assert.equal(service.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(service.csvCell(' @SUM(1)'), "' @SUM(1)");
  assert.equal(service.csvCell('-12'), '-12');
  assert.equal(service.display('sgpa', null), '-');
  assert.equal(service.display('percentage', '65'), '65.00');
  assert.equal(service.display('percentage', null), '-');
  assert.equal(service.display('percentage', 0), '0.00');
  assert.equal(service.display('grade', null), '-');
  assert.equal(service.display('internal_marks', null), '-');
  assert.equal(service.display('external_marks', null), '-');
  assert.equal(service.csvValue('internal_marks', null), '');
  assert.equal(service.csvValue('external_marks', null), '');
  assert.equal(service.csvValue('internal_marks', 0), '0');
  for (const key of ['sgpa', 'cgpa', 'percentage']) {
    assert.equal(service.csvReportCell(key, 9), '"=""9.00"""');
    assert.equal(service.csvReportCell(key, '8'), '"=""8.00"""');
    assert.equal(service.csvReportCell(key, '9.5'), '"=""9.50"""');
    assert.equal(service.csvReportCell(key, 0), '"=""0.00"""');
    assert.equal(service.csvReportCell(key, null), '-');
    assert.equal(service.csvReportCell(key, '=1+1'), "'=1+1");
    assert.equal(service.csvReportCell(key, '9"&HYPERLINK("x")'), service.csvCell('9"&HYPERLINK("x")'));
  }
  assert.equal(service.csvReportCell('student_name', '=1+1'), "'=1+1");
  assert.equal(service.csvReportCell('total_marks', 9), '9');
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
    for (const endpoint of ['/reports/student-progress', '/reports/api/student-progress', '/reports/student-progress/export.csv', '/reports/student-progress/print', '/reports/result-analysis', '/reports/api/result-analysis', '/reports/result-analysis/export.csv', '/reports/result-analysis/print', '/reports/consolidated', '/reports/api/consolidated', '/reports/consolidated/export.csv', '/reports/consolidated/print', '/reports/toppers', '/reports/api/toppers', '/reports/toppers/export.csv', '/reports/toppers/print', '/reports/student', '/reports/api/student', '/reports/student/export.csv', '/reports/student/print', '/reports/api/student-semesters?batch_id=1&student_id=1', '/reports/api/student-sessions?batch_id=1&student_id=1']) {
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
   UNION ALL SELECT 2, 2, '1', 'JUN', 2026
   UNION ALL SELECT 3, 1, '2', 'JUN', 2026
   UNION ALL SELECT 4, 1, '10', 'DEC', 2027
   UNION ALL SELECT 5, 1, '4', 'DEC', 2026
   UNION ALL SELECT 6, 1, '3', 'DEC', 2026
   UNION ALL SELECT 7, 1, '1', 'AUG', 2026),
 students AS (SELECT 1 student_id, 1 batch_id, 'USN1' usn, 'Student One' student_name, NULL deleted_at, 'PGCET' category
   UNION ALL SELECT 2, 1, 'USN2', 'Student Two', NULL, NULL
   UNION ALL SELECT 3, 1, 'USN3', 'Deleted', '2026-01-01', 'MGT'
   UNION ALL SELECT 4, 2, 'USN4', 'Other Batch', NULL, 'MGT'),
 subjects AS (SELECT 1 subject_id, 1 session_id, 'MCA101' subject_code, 'Subject One' subject_name, 4 credits, 100 max_marks
   UNION ALL SELECT 2, 1, 'MCA102', 'Subject Two', 4, 100
   UNION ALL SELECT 3, 2, 'MCA101', 'Other Session', 4, 100
   UNION ALL SELECT 4, 3, 'MCA201', 'Semester Two', 4, 100
   UNION ALL SELECT 5, 4, 'MCA1001', 'Semester Ten', 4, 100
   UNION ALL SELECT 6, 5, 'MCA401', 'Semester Four', 4, 100
   UNION ALL SELECT 7, 7, 'MCA101', 'Another Session', 4, 100),
 results AS (SELECT 1 result_id, 1 student_id, 1 session_id, 1 attempt_no, 'REGULAR' exam_type, 3.5 sgpa, NULL cgpa, 'fail' result_status, 1 failed_subject_count
   UNION ALL SELECT 2, 1, 1, 2, 'BACKLOG', 6.0, 6.0, 'pass', 0
   UNION ALL SELECT 3, 2, 1, 1, 'REGULAR', NULL, NULL, 'fail', 1
   UNION ALL SELECT 4, 3, 1, 1, 'REGULAR', 9.0, 9.0, 'pass', 0
   UNION ALL SELECT 5, 2, 1, 2, 'REPEAT', NULL, NULL, 'fail', 0
   UNION ALL SELECT 6, 2, 1, 3, 'SUPPLEMENTARY', NULL, NULL, 'fail', 1
   UNION ALL SELECT 7, 1, 3, 1, 'REGULAR', 8, 8, 'pass', 0
   UNION ALL SELECT 8, 1, 4, 1, 'REGULAR', 8, 8, 'pass', 0
   UNION ALL SELECT 9, 1, 5, 1, 'REGULAR', 8, 8, 'pass', 0
   UNION ALL SELECT 10, 1, 7, 1, 'SUPPLEMENTARY', 8, 8, 'pass', 0
   UNION ALL SELECT 11, 1, 3, 2, 'BACKLOG', 8, 8, 'pass', 0),
 subject_results AS (SELECT 1 subject_result_id, 1 result_id, 1 subject_id, 30 marks, NULL internal_marks, NULL external_marks, 'F' grade, 'fail' result_status
   UNION ALL SELECT 2, 1, 2, 70, 40, 30, 'A', 'pass'
   UNION ALL SELECT 3, 2, 1, 65, NULL, NULL, 'B+', 'pass'
   UNION ALL SELECT 4, 3, 1, 35, NULL, NULL, NULL, 'fail'
   UNION ALL SELECT 5, 4, 1, 90, NULL, NULL, 'O', 'pass'
   UNION ALL SELECT 6, 6, 2, 25, NULL, NULL, 'F', 'fail'
   UNION ALL SELECT 7, 7, 4, 80, 42, 38, 'A+', 'pass'
   UNION ALL SELECT 8, 8, 5, 80, 42, 38, 'A+', 'pass'
   UNION ALL SELECT 9, 9, 6, 80, 42, 38, 'A+', 'pass'
   UNION ALL SELECT 10, 10, 7, 80, 42, 38, 'A+', 'pass'
   UNION ALL SELECT 11, 11, 4, 80, 0, 80, 'A+', 'pass'),
 faculty AS (SELECT 1 faculty_id, 'Faculty A' faculty_name, NULL deleted_at
   UNION ALL SELECT 2, 'Faculty B', NULL
   UNION ALL SELECT 3, 'Deleted Faculty', '2026-01-01'),
 subject_faculty AS (SELECT 1 subject_id, 1 faculty_id
   UNION ALL SELECT 1, 2
   UNION ALL SELECT 2, 3),
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
  const realQuery = db.sequelize.query.bind(db.sequelize);
  const originalQuery = (sql, options) => {
    // Add authoritative course identities to the existing read-only CTE fixtures.
    const boundary = sql.indexOf('\n SELECT');
    const split = boundary >= 0 ? boundary : sql.search(/\)\s+SELECT /) + 1;
    const source = sql.slice(0, split).replace(' subjects AS', ' offering_fixture AS').replace(' results AS', ' result_fixture AS').replace(' subject_results AS', ' marks_fixture AS');
    const additions = `,
      academic_courses AS (SELECT MIN(s.subject_id) course_id,rs.batch_id,rs.semester,s.subject_code,MIN(s.subject_name) subject_name,
        4 credits,50 max_internal,50 max_external,100 max_marks,'active' status,1 is_required,1 roster_verified
        FROM offering_fixture s JOIN result_sessions rs ON rs.session_id=s.session_id GROUP BY rs.batch_id,rs.semester,s.subject_code),
      subjects AS (SELECT s.*,c.course_id FROM offering_fixture s JOIN result_sessions rs ON rs.session_id=s.session_id
        JOIN academic_courses c ON c.batch_id=rs.batch_id AND c.semester=rs.semester AND c.subject_code=s.subject_code),
      results AS (SELECT r.*,'LEGACY' sgpa_source,'LEGACY' cgpa_source,0 cgpa_is_cumulative,NULL grading_scheme_version FROM result_fixture r),
      subject_results AS (SELECT sr.*,NULL course_id_snapshot,NULL grade_point,NULL credits_snapshot,NULL grading_scheme_version FROM marks_fixture sr)
    `;
    return realQuery(source + additions + sql.slice(split), options);
  };
  db.sequelize.query = (sql, options) => {
    assert.match(sql.trim(), /^SELECT\b/i);
    return originalQuery(fixture + sql, options);
  };
  try {
    await t.test('student progression has one row per student, dynamic semesters, canonical marks and stored GPA', async () => {
      const report = await service.getReport('student-progress', { batch_id: '1', mode: 'original' });
      assert.deepEqual(report.semesters.map(term => term.semester), ['1', '2', '4', '10']);
      assert.deepEqual(report.rows.map(row => row.usn), ['USN1', 'USN2']);
      assert.equal(report.rows[0].category, 'PGCET');
      assert.equal(report.rows[1].category, null);
      assert.equal(Number(report.rows[0].semesters['1'].marks), 100);
      assert.equal(Number(report.rows[0].semesters['1'].sgpa), 3.5);
      assert.equal(report.rows[0].semesters['1'].cgpa, null);
      assert.equal(report.rows[0].semesters['1'].first_attempt, 'F');
      assert.equal(report.rows[0].semesters['1'].supplementary_pass, 'P', 'Stable course identity combines later cross-session passes');
      assert.equal(report.rows[0].semesters['2'].first_attempt, 'P');
      assert.equal(report.rows[0].semesters['2'].supplementary_pass, '-');
      assert.equal(report.rows[0].latest_cgpa, null, 'Legacy GPA is not certified cumulative');
      assert.equal(report.rows[1].semesters['2'].marks, null);
      assert.equal(report.rows[1].semesters['2'].first_attempt, '-');
      assert.equal(report.rows[1].latest_cgpa, null);
      const effective = await service.getReport('student-progress', { batch_id: '1' });
      assert.equal(Number(effective.rows[0].semesters['1'].marks), 135);
      assert.equal(effective.rows[0].semesters['1'].first_attempt, 'P');
      assert.equal(effective.rows[1].semesters['1'].marks, null, 'An incomplete first sitting is not an authoritative semester total');
      assert.equal(effective.rows[1].semesters['1'].supplementary_pass, '-');
      assert.equal(Number(effective.rows[0].semesters['1'].sgpa), 3.5, 'Effective SGPA is not invented');
      const noResults = await service.getReport('student-progress', { batch_id: '2' });
      assert.equal(noResults.rows.length, 1); assert.equal(noResults.semesters.length, 0);
      assert.equal(noResults.rows[0].latest_cgpa, null);
      await assert.rejects(service.getReport('student-progress', { batch_id: '999' }), /Batch not found/);
    });
    await t.test('progression supplementary proof requires every baseline subject, not a partial Result PASS', async () => {
      const saved = db.sequelize.query;
      try {
        const sameSession = fixture.replace("1, 7, 1, 'SUPPLEMENTARY'", "1, 7, 1, 'REGULAR'");
        db.sequelize.query = (sql, options) => originalQuery(sameSession + sql, options);
        const cleared = await service.getReport('student-progress', { batch_id: '1', mode: 'original' });
        assert.equal(cleared.rows[0].semesters['1'].first_attempt, 'F');
        assert.equal(cleared.rows[0].semesters['1'].supplementary_pass, 'P');
        assert.equal(Number(cleared.rows[0].semesters['1'].marks), 100, 'Backlog marks are not added to first-sitting marks');
        const failed = sameSession.replace("65, NULL, NULL, 'B+', 'pass'", "65, NULL, NULL, 'B+', 'fail'")
          .replace("10, 10, 7, 80, 42, 38, 'A+', 'pass'", "10, 10, 7, 80, 42, 38, 'F', 'fail'");
        db.sequelize.query = (sql, options) => originalQuery(failed + sql, options);
        assert.equal((await service.getReport('student-progress', { batch_id: '1', mode: 'original' })).rows[0].semesters['1'].supplementary_pass, 'F');
        const missing = sameSession.replace(/\),\s*results AS/, " UNION ALL SELECT 99, 1, 'MCA100', 'Missing subject', 4, 100), results AS");
        db.sequelize.query = (sql, options) => originalQuery(missing + sql, options);
        const unknown = await service.getReport('student-progress', { batch_id: '1', mode: 'original' });
        assert.equal(unknown.rows[0].semesters['1'].supplementary_pass, '-');
        const onlyLater = fixture.replace("1 attempt_no, 'REGULAR' exam_type", "1 attempt_no, 'BACKLOG' exam_type");
        db.sequelize.query = (sql, options) => originalQuery(onlyLater + sql, options);
        assert.equal((await service.getReport('student-progress', { batch_id: '1' })).rows[0].semesters['1'].first_attempt, '-');
      } finally { db.sequelize.query = saved; }
    });
    await t.test('progression paginates students and exports all, with no-result students retained', async () => {
      const saved = db.sequelize.query;
      try {
        const added = Array.from({ length: 30 }, (_, i) => ` UNION ALL SELECT ${100 + i}, 1, 'ZZZ${String(i).padStart(2, '0')}', 'No Result ${i}', NULL, NULL`).join('');
        const many = fixture.replace(/\),\s*subjects AS/, `${added}), subjects AS`);
        let count = 0;
        db.sequelize.query = (sql, options) => { count++; return originalQuery(many + sql, options); };
        const page = await service.getReport('student-progress', { batch_id: '1', page: '2' });
        assert.equal(page.pagination.totalRows, 32); assert.equal(page.rows.length, 7); assert.equal(count, 8);
        assert.equal(page.rows[0].semesters['1'].first_attempt, '-');
        assert.equal(page.rows[0].semesters['1'].marks, null);
        const all = []; for await (const row of service.fullRows(page)) all.push(row);
        assert.equal(all.length, 32); assert.equal(new Set(all.map(row => row.student_id)).size, 32);
        const future = fixture.replace(/\),\s*subject_results AS/, " UNION ALL SELECT 999, 1, 6, 1, 'REGULAR', NULL, NULL, 'fail', 0), subject_results AS");
        db.sequelize.query = (sql, options) => originalQuery(future + sql, options);
        assert.deepEqual((await service.getReport('student-progress', { batch_id: '1' })).semesters.map(term => term.semester), ['1', '2', '3', '4', '10']);
      } finally { db.sequelize.query = saved; }
    });
    await t.test('result analysis groups exact participation with canonical original/effective statuses and assigned staff', async () => {
      const original = await service.getReport('result-analysis', { ...base, mode: 'original' });
      assert.deepEqual(original.rows.map(row => row.subject_code), ['MCA101', 'MCA102']);
      assert.deepEqual(original.rows[0].regular, { appeared: 2, passed: 0, passPercentage: 0 });
      assert.deepEqual(original.rows[0].repeaters, { appeared: 1, passed: 1, passPercentage: 100 });
      assert.deepEqual(original.rows[0].total, { appeared: 3, passed: 1, passPercentage: 33.33 });
      assert.deepEqual(original.rows[1].regular, { appeared: 1, passed: 1, passPercentage: 100 });
      assert.deepEqual(original.rows[1].repeaters, { appeared: 1, passed: 0, passPercentage: 0 });
      assert.deepEqual(original.rows[1].total, { appeared: 2, passed: 1, passPercentage: 50 });
      assert.equal(original.rows[0].staff, 'Faculty A / Faculty B');
      assert.equal(original.rows[1].staff, '-');
      assert.deepEqual(original.overall, { appeared: 5, passed: 1, failed: 4, unavailable: 0, passPercentage: 20 });
      const effective = await service.getReport('result-analysis', base);
      assert.deepEqual(effective.rows[0].regular, { appeared: 2, passed: 1, passPercentage: 50 });
      assert.deepEqual(effective.rows[0].repeaters, { appeared: 1, passed: 0, passPercentage: 0 });
      assert.equal(effective.rows[0].total.appeared, 3, 'Ledger events do not multiply APP');
      assert.equal(effective.rows[1].repeaters.passed, 0, 'Rejected RV does not change PASS');
      assert.equal(effective.rows[0].regular.passed, 1, 'Pending RV for second regular student is ignored');
      assert.deepEqual(effective.overall, { appeared: 5, passed: 1, failed: 3, unavailable: 1, passPercentage: 20 });
      assert.deepEqual(effective.chart.values, effective.subjects.map(subject => subject.total.passPercentage));
      assert.deepEqual(effective.chart.labels, ['MCA101', 'MCA102']);
      assert.equal(effective.pagination.totalPages, 1);
      await assert.rejects(service.getReport('result-analysis', { ...base, session_id: '2' }), /does not belong/);
      await assert.rejects(service.getReport('result-analysis', { ...base, semester: '2' }), /does not belong/);
      const repeatOnly = await service.getReport('result-analysis', { ...base, session_id: '7' });
      assert.deepEqual(repeatOnly.rows[0].regular, { appeared: 0, passed: 0, passPercentage: 0 });
      assert.deepEqual(repeatOnly.rows[0].repeaters, { appeared: 1, passed: 1, passPercentage: 100 });
      const empty = await service.getReport('result-analysis', { ...base, semester: '3', session_id: '6' });
      assert.equal(empty.rows.length, 0); assert.equal(empty.overall.appeared, 0); assert.equal(empty.overall.passPercentage, 0);
    });
    await t.test('analysis retains zero-appearance subjects and never sums subject APP for overall APP', async () => {
      const saved = db.sequelize.query;
      try {
        const added = fixture.replace(/\),\s*results AS/, " UNION ALL SELECT 99, 1, 'MCA100', 'Additional', 4, 100), results AS")
          .replace(/\),\s*faculty AS/, " UNION ALL SELECT 999, 1, 99, 90, NULL, NULL, 'A', 'pass'), faculty AS");
        let count = 0;
        db.sequelize.query = (sql, options) => { count++; return originalQuery(added + sql, options); };
        const report = await service.getReport('result-analysis', base);
        assert.equal(report.rows.reduce((sum, row) => sum + row.total.appeared, 0), 6);
        assert.equal(report.overall.appeared, 5);
        assert.equal(count, 5, 'Batch, session, subject aggregates, staff batch and overall aggregates');
        const zero = fixture.replace(/\),\s*results AS/, " UNION ALL SELECT 99, 1, 'MCA100', 'No participation', 4, 100), results AS");
        db.sequelize.query = (sql, options) => originalQuery(zero + sql, options);
        const zeroReport = await service.getReport('result-analysis', { ...base, page: '99', pageSize: '25' });
        assert.equal(zeroReport.rows.length, 3);
        assert.deepEqual(zeroReport.rows[0].total, { appeared: 0, passed: 0, passPercentage: 0 });
        assert.equal(zeroReport.pagination.page, 1);
        const unknown = fixture.replace("35, NULL, NULL, NULL, 'fail'", '35, NULL, NULL, NULL, NULL');
        db.sequelize.query = (sql, options) => originalQuery(unknown + sql, options);
        const missing = await service.getReport('result-analysis', base);
        assert.equal(missing.rows[0].regular.appeared, 2);
        assert.equal(missing.rows[0].regular.passed, 1);
        assert.equal(missing.overall.unavailable, 2);
      } finally { db.sequelize.query = saved; }
    });
    await t.test('consolidated dynamically pivots exact attempts, original components and approved-effective totals', async () => {
      const original = await service.getReport('consolidated', { ...base, mode: 'original' });
      assert.deepEqual(original.subjects.map(subject => subject.subject_code), ['MCA101', 'MCA102']);
      assert.deepEqual(original.rows.map(row => Number(row.result_id)), [1, 2, 3, 5, 6]);
      const row = original.rows[0];
      assert.equal(Number(row.total_marks), 100);
      assert.equal(Number(row.maximum_marks), 200);
      assert.equal(Number(row.percentage), 50);
      assert.equal(Number(row.sgpa), 3.5);
      assert.equal(row.subject_marks[1].external, null);
      assert.equal(row.subject_marks[1].internal, null);
      assert.equal(Number(row.subject_marks[2].external), 30);
      assert.equal(Number(row.subject_marks[2].internal), 40);
      assert.equal(Number(row.subject_marks[2].total), 70);
      assert.equal(original.rows[1].subject_2_T, null);
      assert.equal(Number(original.rows[1].maximum_marks), 100);
      assert.equal(Number(original.rows[1].percentage), 65);
      assert.equal(original.rows[3].total_marks, null);
      assert.equal(original.rows[3].percentage, null);
      const effective = await service.getReport('consolidated', base);
      assert.equal(Number(effective.rows[0].subject_1_T), 60);
      assert.equal(Number(effective.rows[0].total_marks), 135);
      assert.equal(Number(effective.rows[0].percentage), 67.5);
      assert.equal(Number(effective.rows[0].subject_2_EX), 30, 'EX is not effective total minus IA');
      assert.equal(Number(effective.rows[0].subject_2_IA), 40);
      assert.equal(effective.rows[0].subject_marks[1].effective, true);
      assert.equal(Number(effective.rows[0].sgpa), 3.5);
      assert.equal(effective.trailingColumns.at(-1).label, 'SGPA (Stored)');
      assert.equal(Number(effective.rows[2].total_marks), 35, 'Pending RV is ignored');
      assert.equal(Number(effective.rows[4].total_marks), 25, 'Rejected RV is ignored');
      const backlog = await service.getReport('consolidated', { ...base, exam_type: 'BACKLOG' });
      assert.equal(backlog.rows.length, 1);
      assert.equal(Number(backlog.rows[0].attempt_no), 2);
      await assert.rejects(service.getReport('consolidated', { ...base, session_id: '2' }), /does not belong/);
      await assert.rejects(service.getReport('consolidated', { ...base, semester: '2' }), /does not belong/);
      const empty = await service.getReport('consolidated', { ...base, semester: '3', session_id: '6' });
      assert.equal(empty.subjects.length, 0); assert.equal(empty.rows.length, 0);
    });
    await t.test('consolidated percentage uses varying actual maxima and query count stays batched', async () => {
      const saved = db.sequelize.query;
      let count = 0;
      try {
        const varied = fixture.replace("'Subject Two', 4, 100", "'Subject Two', 4, 150");
        db.sequelize.query = (sql, options) => { count++; return originalQuery(varied + sql, options); };
        const report = await service.getReport('consolidated', { ...base, mode: 'original' });
        assert.equal(Number(report.rows[0].maximum_marks), 250);
        assert.equal(Number(report.rows[0].percentage), 40);
        assert.equal(count, 6, 'Batch, session, summary, subjects, result page and subject batch');
        const unusedSubject = fixture.replace(/\),\s*results AS/, " UNION ALL SELECT 99, 1, 'MCA100', 'Configured but missing', 4, 500), results AS");
        db.sequelize.query = (sql, options) => originalQuery(unusedSubject + sql, options);
        const dynamic = await service.getReport('consolidated', { ...base, mode: 'original' });
        assert.deepEqual(dynamic.subjects.map(subject => subject.subject_code), ['MCA100', 'MCA101', 'MCA102']);
        assert.equal(dynamic.rows[0].subject_99_EX, null);
        assert.equal(dynamic.rows[0].subject_99_IA, null);
        assert.equal(dynamic.rows[0].subject_99_T, null);
        assert.equal(Number(dynamic.rows[0].maximum_marks), 200);
        assert.equal(Number(dynamic.rows[0].percentage), 50);
        db.sequelize.query = (sql, options) => originalQuery(fixture.replace('4 credits, 100 max_marks', '4 credits, 0 max_marks') + sql, options);
        const invalid = await service.getReport('consolidated', base);
        assert.equal(invalid.rows[0].percentage, null);
      } finally { db.sequelize.query = saved; }
    });
    await t.test('consolidated paginates Result attempts, not subjects; full export ignores preview page', async () => {
      const saved = db.sequelize.query;
      try {
        const additional = Array.from({ length: 30 }, (_, i) => ` UNION ALL SELECT ${100 + i}, 1, 1, ${10 + i}, 'REGULAR', 8, 8, 'pass', 0`).join('');
        const many = fixture.replace(/\),\s*subject_results AS/, `${additional}), subject_results AS`);
        db.sequelize.query = (sql, options) => originalQuery(many + sql, options);
        const page = await service.getReport('consolidated', { ...base, page: '2', mode: 'original' });
        assert.equal(page.pagination.totalRows, 35);
        assert.equal(page.rows.length, 10);
        assert.equal(page.subjects.length, 2);
        assert.equal(page.pagination.page, 2);
        const all = [];
        for await (const row of service.fullRows(page)) all.push(row);
        assert.equal(all.length, 35);
        assert.equal(new Set(all.map(row => Number(row.result_id))).size, 35);
        assert.equal(Number(all[0].result_id), 1);
        assert.equal(Number(all.at(-1).result_id), 6);
      } finally { db.sequelize.query = saved; }
    });
    await t.test('toppers use stored passing CGPA, stable ranks, explicit attempts and scoped sessions', async () => {
      const first = await service.getReport('toppers', base);
      assert.equal(first.rows.length, 1);
      assert.equal(first.rows[0].usn, 'USN1');
      assert.equal(Number(first.rows[0].attempt_no), 2);
      assert.equal(Number(first.rows[0].cgpa), 6);
      assert.equal(Number(first.rows[0].total_marks), 65);
      assert.equal(Number(first.rows[0].percentage), 65);
      assert.deepEqual(first.columns.map(column => column.label), ['Rank', 'USN', 'Student Name', 'Attempt No.', 'Exam Type', 'Subjects', 'Passed', 'Total', 'SGPA', 'CGPA', '% Percentage', 'Result']);
      assert.equal(first.filters.mode, 'original');
      assert.equal(Number(first.rows[0].position), 1);
      const tied = await service.getReport('toppers', { ...base, semester: '2', session_id: '3' });
      assert.deepEqual(tied.rows.map(row => [Number(row.position), Number(row.attempt_no)]), [[1, 1], [2, 2]]);
      const regular = await service.getReport('toppers', { ...base, exam_type: 'REGULAR' });
      assert.equal(regular.rows.length, 0, 'Failed, NULL CGPA and soft-deleted results are excluded');
      const backlog = await service.getReport('toppers', { ...base, exam_type: 'BACKLOG' });
      assert.equal(backlog.rows.length, 1);
      await assert.rejects(service.getReport('toppers', { ...base, session_id: '2' }), /does not belong/);
      assert.match(first.context.find(([label]) => label === 'Ranking Basis')[1], /original CGPA/);
    });
    await t.test('toppers totals sum subject marks and handle missing marks or invalid maxima', async () => {
      const saved = db.sequelize.query;
      try {
        const passing = fixture.replace("3.5 sgpa, NULL cgpa, 'fail' result_status", "3.5 sgpa, 7 cgpa, 'pass' result_status")
          .replace("'F' grade, 'fail' result_status", "'F' grade, 'pass' result_status");
        db.sequelize.query = (sql, options) => originalQuery(passing + sql, options);
        const report = await service.getReport('toppers', base);
        assert.equal(Number(report.rows[0].total_marks), 100);
        assert.equal(Number(report.rows[0].percentage), 50);
        for (const changed of [fixture.replace('65, NULL, NULL', 'NULL, NULL, NULL'), fixture.replace('4 credits, 100 max_marks', '4 credits, 0 max_marks')]) {
          db.sequelize.query = (sql, options) => originalQuery(changed + sql, options);
          const missing = await service.getReport('toppers', base);
          assert.equal(missing.rows[0].percentage, null);
        }
      } finally { db.sequelize.query = saved; }
    });
    await t.test('original remains unchanged; only highest approved-effective event overlays', async () => {
      const original = await service.getReport('student', { ...base, student_id: '1', attempt_no: '1', mode: 'original' });
      const effective = await service.getReport('student', { ...base, student_id: '1', attempt_no: '1' });
      assert.deepEqual(original.rows.map(r => Number(r.marks)), [30, 70]);
      assert.deepEqual(effective.rows.map(r => Number(r.marks)), [60, 75]);
      assert.equal(effective.rows[0].result_status, 'pass');
      assert.equal(effective.rows[0].grade, 'B+');
      assert.equal(effective.meta.result.result_status, 'fail');
      assert.equal(effective.metrics.some(([label]) => /SGPA|CGPA/.test(label)), false);
      assert.equal(effective.columns.some(c => c.key === 'internal_marks'), true);
      assert.equal(effective.rows[0].internal_marks, null);
      assert.equal(Number(effective.rows[1].internal_marks), 40);
      assert.equal(Number(effective.rows[1].external_marks), 30);
      assert.equal(Number(effective.rows[1].marks), 75);
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
    await t.test('completed semesters and sessions are student-driven, numerically ordered, and future-ready', async () => {
      const query = { batch_id: '1', student_id: '1', semester: 'all', session_id: 'all' };
      const semesters = await service.getOptions('student-semesters', query);
      assert.deepEqual(semesters.map(row => row.semester), ['1', '2', '4', '10']);
      const report = await service.getReport('student', query);
      assert.deepEqual(report.semesters.map(term => term.semester), ['1', '2', '4', '10']);
      assert.deepEqual(report.semesters[0].sessions[0].attempts.map(attempt => Number(attempt.result.attempt_no)), [1, 2]);
      assert.equal(report.semesters[0].sessions.length, 2);
      assert.equal(report.semesters[1].sessions[0].attempts.length, 2);
      assert.equal(report.rows.length, 8);
      assert.equal(report.semesters.some(term => term.semester === '3'), false);
      const earlier = fixture.replace('UNION ALL SELECT 9, 1, 5, 1, \'REGULAR\', 8, 8, \'pass\', 0', '');
      db.sequelize.query = (sql, options) => originalQuery(earlier + sql, options);
      const previous = await service.getOptions('student-semesters', query);
      assert.deepEqual(previous.map(row => row.semester), ['1', '2', '10']);
      db.sequelize.query = (sql, options) => originalQuery(fixture + sql, options);
      const updated = await service.getOptions('student-semesters', query);
      assert.deepEqual(updated.map(row => row.semester), ['1', '2', '4', '10']);
    });
    await t.test('specific semester/all sessions; all semesters/scoped session; unknown and empty scopes', async () => {
      const query = { batch_id: '1', student_id: '1', semester: '1', session_id: 'all' };
      const report = await service.getReport('student', query);
      assert.equal(report.semesters.length, 1);
      assert.equal(report.semesters[0].sessions.length, 2);
      assert.equal(report.rows.length, 4);
      const sessions = await service.getOptions('student-sessions', query);
      assert.deepEqual(sessions.map(row => Number(row.session_id)), [1, 7]);
      const one = await service.getReport('student', { ...query, semester: 'all', session_id: '3', attempt_no: '2' });
      assert.equal(one.semesters[0].semester, '2');
      assert.equal(Number(one.rows[0].internal_marks), 0);
      await assert.rejects(service.getReport('student', { ...query, semester: '1', session_id: '3', attempt_no: '1' }), /does not belong/);
      await assert.rejects(service.getReport('student', { ...query, attempt_no: '1' }), /requires a specific/);
      await assert.rejects(service.getOptions('student-sessions', { ...query, student_id: '4' }), /does not belong/);
      const empty = await service.getReport('student', { ...query, semester: '3' });
      assert.equal(empty.semesters.length, 0);
      assert.equal(empty.rows.length, 0);
      const noResults = await service.getReport('student', { batch_id: '2', student_id: '4', semester: 'all', session_id: 'all' });
      assert.equal(noResults.semesters.length, 0);
      let queries = 0;
      db.sequelize.query = (sql, options) => { queries++; return originalQuery(fixture + sql, options); };
      await service.getReport('student', { ...query, semester: 'all' });
      assert.equal(queries, 4, 'All semesters use batched result and subject queries, independent of hierarchy size');
      db.sequelize.query = (sql, options) => originalQuery(fixture + sql, options);
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
          const query = new URLSearchParams({ ...(type === 'student-progress' ? { batch_id: '1' } : base), ...(type === 'student' ? { student_id: '1', attempt_no: '1' } : {}), ...(type === 'subject' ? { subject_id: '1' } : {}) });
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
          const csvText = await csv.text();
          assert.match(csvText, /USN1|Subject One/);
          if (type === 'toppers') {
            assert.match(csvText, /\r\nRank,USN,Student Name,Attempt No\.,Exam Type,Subjects,Passed,Total,SGPA,CGPA,% Percentage,Result/);
            assert.match(csvText, /65\.00/);
            assert.match(csvText, /"=""65\.00"""/);
            assert.match(csvText, /"=""6\.00"""/);
            assert.doesNotMatch(csvText, /Sl\. No\./);
          }
          if (type === 'consolidated') {
            assert.match(csvText, /Sl\. No\.,USN,Name,Attempt,Exam Type,MCA101,,,MCA102,,,TOTAL,%,SGPA \(Stored\)/);
            assert.match(csvText, /\r\n,,,,,EX,IA,T,EX,IA,T,,,\r\n/);
            assert.match(csvText, /1,USN1,Student One,1,REGULAR,,,60,30,40,75,135,"=""67\.50""","=""3\.50"""/);
            assert.match(csvText, /5,USN2,Student Two,3,SUPPLEMENTARY/);
          }
          if (type === 'result-analysis') {
            assert.match(csvText, /Subject Code,Name of the Subject,Regular APP,Regular PASS,Regular % PASS,Repeaters APP/);
            assert.match(csvText, /Faculty A \/ Faculty B/);
            assert.match(csvText, /\r\nTOTAL APP,5\r\nTOTAL FAIL,3\r\nTOTAL PASS,1\r\nPASS %,20\.00/);
            assert.doesNotMatch(html, /report-pageSize/);
          }
          if (type === 'student-progress') {
            assert.match(csvText, /Successfully Completed With Back Log - First Year/);
            assert.match(csvText, /Successfully Completed Without Back Log - Second Year/);
            assert.doesNotMatch(csvText, /Sem \d+ (With|Without) Backlog/);
            assert.match(csvText, /Sl\. No\.,USN,Name,Category,Semester 1,,,,,Semester 2,,,,,Semester 4,,,,,Semester 10,,,,,Cumulative CGPA/);
            assert.match(csvText, /Marks Obt\.,SGPA,CGPA,First Attempt,Pass in Supplementary/);
            assert.match(csvText, /1,USN1,Student One,PGCET,135/);
            assert.match(csvText, /2,USN2,Student Two/);
            assert.doesNotMatch(html, /name="session_id"|name="semester"/);
          }
          const print = await fetch(`${url}/reports/${type}/print?${query}`);
          assert.equal(print.status, 200);
          const printText = await print.text();
          assert.match(printText, /reports-print/);
          if (type === 'toppers') {
            assert.doesNotMatch(printText, /Sl\. No\./);
            assert.match(printText, /% Percentage/);
          }
          if (type === 'consolidated') {
            assert.equal((printText.match(/<tr><td>/g) || []).length, 5);
            assert.match(printText, /scope="colgroup" colspan="3"/);
            assert.match(printText, /rowspan="2"/);
            assert.match(printText, /<td>-<\/td>/);
            assert.match(printText, /SGPA is the stored original/);
          }
          if (type === 'result-analysis') {
            assert.match(printText, /RESULTS ANALYSIS CHART OF 1 SEM MCA/);
            assert.match(printText, /reports-analysis-chart/);
            assert.match(printText, /REGULAR[\s\S]*REPEATERS[\s\S]*TOTAL/);
            const data = printText.match(/<script id="reports-analysis-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
            assert.deepEqual(JSON.parse(data).chart.values, [33.33, 50]);
          }
          if (type === 'student-progress') {
            assert.match(printText, /reports-progress-print/);
            assert.equal((printText.match(/Successfully Completed<br>/g) || []).length, 2);
            assert.match(printText, /class="reports-completion-group" colspan="5"/);
            assert.match(printText, />First Year<\/th>/);
            assert.doesNotMatch(printText, /Sem \d+ (With|Without) Backlog/);
            assert.match(printText, /colspan="5"/);
            assert.match(printText, /Results of Students Admitted during the Year 2024/);
            assert.equal((printText.match(/<tr><td>/g) || []).length, 2);
          }
        }
        const consolidated = new URLSearchParams({ batch_id: '1', student_id: '1', semester: 'all', session_id: 'all' });
        const csv = await fetch(`${url}/reports/student/export.csv?${consolidated}`);
        const text = await csv.text();
        assert.match(text, /Semester,Exam Session,Exam Year,Attempt No\.,Exam Type,Subject Code,Subject Name,Credits,IA,External,Total/);
        assert.match(text, /1,JAN,2026,1,REGULAR,MCA101,Subject One,4,,,60,100,B\+,PASS,Effective Result/);
        assert.match(text, /2,JUN,2026,2,BACKLOG,MCA201,Semester Two,4,0,80,80/);
        assert.match(text, /^STUDENT RESULT REPORT\r\nProgram,MCA\r\nBatch,Batch A\r\nUSN,USN1\r\nStudent Name,Student One\r\nResult View,Effective Result/);
        assert.match(text, /SEMESTER 1\r\n\r\nExam Session,JAN 2026\r\nAttempt,1\r\nExam Type,REGULAR/);
        assert.match(text, /Exam Session,JAN 2026\r\nAttempt,2\r\nExam Type,BACKLOG/);
        assert.match(text, /\r\n1,1,JAN,2026,2,BACKLOG,MCA101/);
        assert.match(text, /\r\n1,2,JUN,2026,2,BACKLOG,MCA201/);
        assert.equal((text.match(/Sl\. No\.,Semester,Exam Session/g) || []).length, 7);
        assert.ok(text.indexOf('SEMESTER 2\r\n') < text.indexOf('SEMESTER 4\r\n'));
        assert.ok(text.indexOf('SEMESTER 4\r\n') < text.indexOf('SEMESTER 10\r\n'));
        const originalCsv = await fetch(`${url}/reports/student/export.csv?${consolidated}&mode=original`);
        const originalText = await originalCsv.text();
        assert.match(originalText, /Result View,Original Result/);
        assert.match(originalText, /\r\n1,1,JAN,2026,1,REGULAR,MCA101,Subject One,4,,,30,100,F,FAIL,Original Result/);
        assert.doesNotMatch(originalText, /Revaluated|Marks Basis/);
        const print = await fetch(`${url}/reports/student/print?${consolidated}`);
        const html = await print.text();
        assert.ok(html.indexOf('Semester 1</h2>') < html.indexOf('Semester 2</h2>'));
        assert.ok(html.indexOf('Semester 4</h2>') < html.indexOf('Semester 10</h2>'));
        assert.match(html, /<td>-<\/td>/);
        assert.match(html, /IA and External are original stored components/);
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
  } finally { db.sequelize.query = realQuery; }
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
