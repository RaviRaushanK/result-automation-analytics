'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const outcome = require('../services/subjectOutcome');
const overlay = require('../repositories/revaluationOverlay');
const policy = require('../services/academicPolicy');
const db = require('../database/models');
const reports = require('../services/reportsService');
const analytics = require('../repositories/analyticsRepository');
const academic = require('../services/academicOutcomeService');
const controller = require('../controllers/reportsController');
const settings = require('../services/settingsService');
after(() => db.sequelize.close());

test('shared subject projection preserves authoritative outcomes, fallback provenance, zero and unavailable cells', () => {
  const original = { subject_result_id: 1, internal_marks: 30, external_marks: 15, original_marks: 45,
    original_grade: 'F', original_result_status: 'fail', marks: 50, grade: 'C', result_status: 'pass',
    revaluated: 1, revaluation_id: 8, revised_external_marks: 20 };
  const before = JSON.stringify(original);
  const effective = outcome.presentSubjectOutcome(original, 'effective');
  assert.deepEqual([effective.internal_marks, effective.external_marks, effective.marks, effective.grade, effective.result_status], [30, 20, 50, 'C', 'pass']);
  assert.equal(effective.componentFallback, true); assert.equal(effective.externalSource, 'revised');
  const stored = outcome.presentSubjectOutcome(original, 'original');
  assert.deepEqual([stored.internal_marks, stored.external_marks, stored.marks, stored.grade, stored.result_status], [30, 15, 45, 'F', 'fail']);
  const missing = outcome.presentSubjectOutcome({ ...original, revised_external_marks: null }, 'effective');
  assert.deepEqual([missing.effectiveInternal, missing.effectiveExternal, missing.effectiveTotal], [30, 15, 50]);
  assert.deepEqual([missing.internal_marks, missing.external_marks, missing.marks], [null, null, 50]);
  assert.equal(missing.componentsReconciled, false);
  const zero = outcome.presentSubjectOutcome({ ...original, revised_internal_marks: 0, revised_external_marks: 0, marks: 0, grade: 'F', result_status: 'fail' }, 'effective');
  assert.deepEqual([zero.internal_marks, zero.external_marks, zero.marks], [0, 0, 0]);
  for (const status of ['pending', 'rejected']) {
    const inactive = outcome.presentSubjectOutcome({ ...original, revaluation_status: status }, 'effective');
    assert.deepEqual([inactive.internal_marks, inactive.external_marks, inactive.marks], [30, 15, 45]);
  }
  assert.equal(JSON.stringify(original), before);
  assert.match(overlay.effectiveEventJoin(true), /MAX\(revaluation_no\)/);
  assert.doesNotMatch(overlay.effectiveEventJoin(true), /attempt_no|BACKLOG/);
});

function fixture(events = [], backlogPass = true) {
  const eventRows = events.length ? events : [{ id: 0, subject: 0, status: 'rejected', effective: 0, external: null, total: 0 }];
  const rows = eventRows.map((event, i) => `SELECT ${event.id} ${i ? '' : 'revaluation_id'},${event.subject ?? 1} ${i ? '' : 'subject_result_id'},${event.no ?? event.id} ${i ? '' : 'revaluation_no'},
    ${event.effective ?? 1} ${i ? '' : 'is_effective'},'${event.status || 'approved'}' ${i ? '' : 'revaluation_status'},
    45 ${i ? '' : 'original_marks'},'fail' ${i ? '' : 'original_status'},${event.internal ?? 'NULL'} ${i ? '' : 'revised_internal_marks'},
    ${event.external ?? 'NULL'} ${i ? '' : 'revised_external_marks'},${event.total ?? 50} ${i ? '' : 'revised_marks'},
    '${event.result || 'pass'}' ${i ? '' : 'revised_status'},'${event.grade || 'C'}' ${i ? '' : 'revised_grade'},NULL ${i ? '' : 'reviewed_at'}`).join(' UNION ALL ');
  return `WITH batches AS (SELECT 1 batch_id,'Fixture Batch' batch_name,2025 start_year,2027 end_year,NULL deleted_at),
    students AS (SELECT 1 student_id,1 batch_id,'FIXTURE001' usn,'Fixture Student' student_name,NULL category,NULL deleted_at),
    exam_sessions AS (SELECT 1 exam_session_id,1 batch_id,'1' semester,'Dec' exam_session,2025 exam_year,12 exam_start_month,2025 exam_start_year,12 exam_end_month,2025 exam_end_year
      UNION ALL SELECT 2,1,'1','Jun',2026,6,2026,6,2026),
    academic_courses AS (SELECT 1 course_id,1 batch_id,'1' semester,'MMC105' subject_code,'Course' subject_name,4 credits,'active' status,1 is_required,1 roster_verified),
    subjects AS (SELECT 1 subject_id,1 exam_session_id,1 course_id,'MMC105' subject_code,'Course' subject_name,4 credits,100 max_marks
      UNION ALL SELECT 2,2,1,'MMC105','Course',4,100),
    results AS (SELECT 1 result_id,1 student_id,1 exam_session_id,1 attempt_no,'REGULAR' exam_type,5.44 sgpa,5.44 cgpa,'fail' result_status,
      1 failed_subject_count,'LEGACY' sgpa_source,'LEGACY' cgpa_source,0 cgpa_is_cumulative,NULL grading_scheme_version
      UNION ALL SELECT 2,1,2,2,'BACKLOG',NULL,5.44,'${backlogPass ? 'pass' : 'fail'}',${backlogPass ? 0 : 1},'UNKNOWN','LEGACY',0,NULL),
    subject_results AS (SELECT 1 subject_result_id,1 result_id,1 subject_id,30 internal_marks,15 external_marks,45 marks,'F' grade,'fail' result_status,
      1 course_id_snapshot,4 credits_snapshot,0 grade_point,'${policy.SCHEME}' grading_scheme_version
      UNION ALL SELECT 2,2,2,30,${backlogPass ? 25 : 18},${backlogPass ? 55 : 48},'${backlogPass ? 'C' : 'F'}','${backlogPass ? 'pass' : 'fail'}',1,4,${backlogPass ? 5 : 0},'${policy.SCHEME}'),
    revaluation_results AS (${rows}) `;
}

test('read-only DB fixtures keep attempt overlays, report/export parity and completion history separate', { skip: process.env.REPORTS_DB_TEST !== '1' }, async t => {
  const realQuery = db.sequelize.query.bind(db.sequelize), branding = settings.getBranding;
  let cte = fixture();
  db.sequelize.query = (sql, options) => {
    assert.match(sql.trim(), /^SELECT\b/i, 'Fixture must never write academic data');
    return realQuery(cte + sql, options);
  };
  settings.getBranding = async () => settings.DEFAULTS;
  const query = { batch_id: '1', semester: '1', exam_session_id: '1', exam_type: 'REGULAR' };
  async function parity(mode, expected, expectedStatus) {
    const student = await reports.getReport('student', { batch_id: '1', semester: '1', exam_session_id: '1', student_id: '1', attempt_no: '1', mode });
    const subject = await reports.getReport('subject', { batch_id: '1', semester: '1', exam_session_id: '1', subject_id: '1', mode });
    const consolidated = await reports.getReport('consolidated', { ...query, mode });
    for (const report of [student, subject]) {
      const row = report.rows[0];
      assert.deepEqual([row.internal_marks, row.external_marks, row.marks], expected);
      assert.equal(row.result_status, expectedStatus); assert.equal(row.attempt_no, 1);
      assert.equal(row.grade, expectedStatus === 'pass' ? 'C' : 'F');
      const html = await ejs.renderFile(path.join(__dirname, '../views/reports/partials/table.ejs'), { columns: report.columns, rows: report.rows, display: reports.display });
      assert.match(html, new RegExp(`>${expected[0] ?? '-'}<\\/td>.*>${expected[1] ?? '-'}<\\/td>.*>${expected[2]}<\\/td>`, 's'));
      const res = { text: '', set() {}, write(text) { this.text += text; return true; }, end() {},
        status() { assert.fail('Report request failed'); }, json(value) { assert.fail(JSON.stringify(value)); } };
      await controller.csv(report.type)({ query: report.filters }, res);
      const lines = res.text.split(/\r?\n/), header = lines.findIndex(line => line.startsWith('Sl. No.,'));
      const names = lines[header].split(','), values = lines[header + 1].split(',');
      assert.deepEqual(['IA', 'External', 'Total'].map(name => values[names.indexOf(name)]), expected.map(value => value == null ? '' : String(value)));
      assert.equal(values[names.indexOf('Result')], expectedStatus.toUpperCase());
      let locals;
      await controller.print(report.type)({ query: report.filters }, { render(view, data) { locals = data; },
        status() { assert.fail('Print failed'); }, json(value) { assert.fail(JSON.stringify(value)); } });
      const print = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), locals);
      assert.match(print, new RegExp(`>${expected[0] ?? '-'}<\\/td>.*>${expected[1] ?? '-'}<\\/td>.*>${expected[2]}<\\/td>`, 's'));
    }
    const row = consolidated.rows[0];
    assert.deepEqual([row.subject_1_IA, row.subject_1_EX, row.subject_1_T], expected);
    assert.equal(Number(row.sgpa), 5.44); assert.equal(row.attempt_no, 1);
    assert.equal(Number(row.total_marks), expected[2]);
    const consolidatedHtml = await ejs.renderFile(path.join(__dirname, '../views/reports/partials/consolidated-table.ejs'), { report: consolidated, display: reports.display });
    assert.match(consolidatedHtml, new RegExp(`>${expected[1] ?? '-'}<\\/td>.*>${expected[0] ?? '-'}<\\/td>.*>${expected[2]}<\\/td>`, 's'));
    const csv = { text: '', set() {}, write(text) { this.text += text; return true; }, end() {},
      status() { assert.fail('Consolidated CSV failed'); }, json(value) { assert.fail(JSON.stringify(value)); } };
    await controller.csv('consolidated')({ query: consolidated.filters }, csv);
    const data = csv.text.split(/\r?\n/).find(line => line.startsWith('1,FIXTURE001,'));
    assert.deepEqual(data.split(',').slice(5, 8), [expected[1], expected[0], expected[2]].map(value => value == null ? '' : String(value)));
    return { student, subject, consolidated };
  }
  try {
    for (const [name, events, values, status] of [
      ['no revaluation', [], [30, 15, 45], 'fail'],
      ['approved regular revaluation', [{ id: 1, external: 20 }], [30, 20, 50], 'pass'],
      ['pending', [{ id: 1, status: 'pending', external: 20 }], [30, 15, 45], 'fail'],
      ['rejected', [{ id: 1, status: 'rejected', external: 20 }], [30, 15, 45], 'fail'],
      ['non-effective', [{ id: 1, effective: 0, external: 20 }], [30, 15, 45], 'fail'],
      ['highest approved effective, not later pending', [{ id: 1, external: 19, total: 49, result: 'fail', grade: 'F' }, { id: 2, external: 20 }, { id: 3, status: 'pending', external: 30, total: 60 }], [30, 20, 50], 'pass'],
      ['missing revised component', [{ id: 1 }], [null, null, 50], 'pass']
    ]) await t.test(name, async () => {
      cte = fixture(events);
      await parity('original', [30, 15, 45], 'fail');
      await parity('effective', values, status);
    });
    await t.test('a later backlog pass clears completion but never changes Attempt 1', async () => {
      cte = fixture();
      await parity('effective', [30, 15, 45], 'fail');
      const progress = academic.semesterOutcome(await academic.load(1, [1], 'effective'), 1, '1');
      assert.equal(progress.withBacklog, 'Y'); assert.equal(progress.withoutBacklog, 'N');
      const failures = await analytics.getFailedStudents({ mode: 'effective', attempt: 'all', exam_type: 'REGULAR' });
      assert.deepEqual(failures.map(row => Number(row.resultId)), [1]);
      const all = await reports.getReport('student', { batch_id: '1', student_id: '1', semester: '1', exam_session_id: 'all', mode: 'effective' });
      assert.deepEqual(all.rows.map(row => [row.attempt_no, row.exam_type, row.result_status]), [[1, 'REGULAR', 'fail'], [2, 'BACKLOG', 'pass']]);
    });
    await t.test('a first-attempt revaluation clears without backlog; backlog revaluation clears with backlog', async () => {
      cte = fixture([{ id: 1, external: 20 }]);
      assert.equal(academic.semesterOutcome(await academic.load(1, [1], 'effective'), 1, '1').withoutBacklog, 'Y');
      assert.equal((await analytics.getFailedStudents({ mode: 'effective', attempt: 'all', exam_type: 'REGULAR' })).length, 0);
      cte = fixture([{ id: 1, subject: 2, external: 22, total: 52 }], false);
      await parity('effective', [30, 15, 45], 'fail');
      const backlog = await reports.getReport('student', { batch_id: '1', student_id: '1', semester: '1', exam_session_id: '2', attempt_no: '2', mode: 'effective' });
      assert.deepEqual([backlog.rows[0].external_marks, backlog.rows[0].marks, backlog.rows[0].result_status], [22, 52, 'pass']);
      assert.equal(academic.semesterOutcome(await academic.load(1, [1], 'effective'), 1, '1').withBacklog, 'Y');
    });
    await t.test('known uncleared history and unverified history are not inferred passes', async () => {
      cte = fixture([], false);
      const failed = academic.semesterOutcome(await academic.load(1, [1], 'effective'), 1, '1');
      assert.equal(failed.cleared, false); assert.equal(failed.withBacklog, 'N');
      cte = fixture().replace('1 roster_verified', '0 roster_verified');
      const unknown = academic.semesterOutcome(await academic.load(1, [1], 'effective'), 1, '1');
      assert.equal(unknown.cleared, null); assert.equal(unknown.withBacklog, '-');
    });
  } finally { db.sequelize.query = realQuery; settings.getBranding = branding; }
});
