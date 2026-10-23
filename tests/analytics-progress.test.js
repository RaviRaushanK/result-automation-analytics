'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/progressAnalyticsService');
const repository = require('../repositories/reportsRepository');
const outcomes = require('../services/academicOutcomeService');
const db = require('../database/models');
after(() => db.sequelize.close());

function fixture(first = 'pass', retakes = []) {
  const courses = [1, 2].map(n => ({ course_id: n, semester: String(n), subject_code: 'C' + n, subject_name: 'Course', status: 'active', is_required: true, roster_verified: true }));
  const regular = { student_id: 1, result_id: 1, session_id: 1, semester: '1', exam_type: 'REGULAR', attempt_no: 7, exam_session: 'Dec', exam_year: 2025 };
  const results = [regular], subjects = [{ ...regular, course_id: 1, outcome_status: first }];
  retakes.forEach(([exam_type, outcome_status], i) => {
    const result = { ...regular, result_id: 2 + i, session_id: 2 + i, attempt_no: 1, exam_type, exam_session: 'Jun', exam_year: 2026 + i };
    results.push(result); subjects.push({ ...result, course_id: 1, outcome_status });
  });
  return { courses, results, subjects };
}
const students = [{ student_id: 1, usn: 'TEST', student_name: 'Test Student' }];
const aggregate = (data, filters = {}) => service.aggregate(data, students, { semester: 1, ...filters });

test('first verified pass is without backlog and excluded from clearance denominator', () => {
  const result = aggregate(fixture());
  assert.equal(result.summary.withoutBacklog, 1); assert.equal(result.summary.backlogStudents, 0); assert.equal(result.summary.clearanceRate, null);
});
for (const type of ['BACKLOG', 'SUPPLEMENTARY', 'REPEAT']) test(`${type} clearance uses canonical outcomes`, () => {
  const result = aggregate(fixture('fail', [[type, 'pass']]));
  assert.equal(result.summary.withBacklog, 1); assert.equal(result.summary.clearanceRate, 100); assert.equal(result.courses[0].cleared, 1);
});
test('multiple session-scoped retakes eventually clear', () => {
  assert.equal(aggregate(fixture('fail', [['BACKLOG', 'fail'], ['REPEAT', 'pass']])).summary.withBacklog, 1);
});
test('known uncleared courses surface an attention link payload and denominator', () => {
  const result = aggregate(fixture('fail', [['SUPPLEMENTARY', 'fail']]));
  assert.equal(result.summary.uncleared, 1); assert.equal(result.summary.clearanceRate, 0);
  assert.equal(result.attention[0].unclearedCourses, 'C1'); assert.match(result.attention[0].latestAttempt, /SUPPLEMENTARY/);
});
test('first failure with no retake remains known uncleared, never fabricated supplementary failure', () => {
  assert.equal(aggregate(fixture('fail')).summary.uncleared, 1);
});
test('later regular pass cannot certify completion with backlog', () => {
  const result = aggregate(fixture('fail', [['REGULAR', 'pass']]));
  assert.equal(result.summary.unknown, 1); assert.equal(result.summary.withBacklog, 0); assert.equal(result.summary.backlogStudents, 0);
});
for (const [name, mutate] of [
  ['unverified roster', d => { d.courses[0].roster_verified = false; }],
  ['missing course outcome', d => { d.subjects = []; }],
  ['unknown result status', d => { d.subjects[0].outcome_status = null; }],
  ['unknown chronology', d => { d.results[0].exam_session = 'Unknown'; }]
]) test(`${name} stays unknown and is excluded from backlog denominator`, () => {
  const data = fixture('fail'); mutate(data); const result = aggregate(data);
  assert.equal(result.summary.unknown, 1); assert.equal(result.summary.uncleared, 0); assert.equal(result.summary.clearanceRate, null);
});
test('future semester is unknown in selected period and absent from participation trends', () => {
  const result = aggregate(fixture(), { semester: 2 });
  assert.equal(result.summary.unknown, 1); assert.equal(result.summary.uncleared, 0);
  assert.deepEqual(result.trends.map(t => t.semester), [1]);
});
test('academic year uses the existing year helper and needs both verified semesters', () => {
  const data = fixture('fail', [['BACKLOG', 'pass']]);
  assert.equal(aggregate(data, { semester: undefined, academic_year: 1 }).summary.unknown, 1);
  const result = { ...data.results[0], result_id: 20, session_id: 20, semester: '2', exam_session: 'Jun', exam_year: 2026 };
  data.results.push(result); data.subjects.push({ ...result, course_id: 2, outcome_status: 'pass' });
  assert.equal(aggregate(data, { semester: undefined, academic_year: 1 }).summary.withBacklog, 1);
});
test('stable course identity prevents different codes or semester offerings from clearing a failure', () => {
  const data = fixture('fail', [['BACKLOG', 'pass']]);
  data.subjects[1].course_id = 999; data.subjects[1].subject_code = 'OTHER';
  assert.equal(aggregate(data).summary.uncleared, 1);
  data.subjects[1].course_id = 1; data.subjects[1].course_id_snapshot = 999;
  assert.equal(aggregate(data).summary.uncleared, 1);
});
test('attention preview is capped at 20 but totals remain accurate', () => {
  const data = fixture('fail'); const population = Array.from({ length: 25 }, (_, i) => ({ ...students[0], student_id: i + 1 }));
  data.results = population.map(s => ({ ...data.results[0], student_id: s.student_id }));
  data.subjects = population.map(s => ({ ...data.subjects[0], student_id: s.student_id }));
  const result = service.aggregate(data, population, { semester: 1 });
  assert.equal(result.summary.uncleared, 25); assert.equal(result.attentionTotal, 25); assert.equal(result.attention.length, 20);
});
test('batch, mode and period validation reject malformed selections', () => {
  assert.equal(service.normalize({ batch_id: '3' }).mode, 'effective');
  assert.equal(service.normalize({ batch_id: '3', mode: 'original' }).mode, 'original');
  assert.equal(service.normalize({ batch_id: '3', semester: '2', mode: 'effective' }).batch_id, 3);
  for (const query of [{}, { batch_id: ['1'] }, { batch_id: '9007199254740992' }, { batch_id: '1', semester: 'x' }, { batch_id: '1', semester: 25 }, { batch_id: '1', semester: 1, academic_year: 1 }]) assert.throws(() => service.normalize(query));
});
test('service forwards batch and Original/Effective mode using batched history, propagating failures', async () => {
  const saved = { batch: repository.batch, count: repository.progressStudentCount, students: repository.progressStudents, terms: repository.progressSemesters, load: outcomes.load };
  const calls = [];
  try {
    repository.batch = async id => ({ batch_id: id });
    repository.progressStudentCount = async f => { assert.equal(f.batch_id, 9); return { total_rows: 1 }; };
    repository.progressStudents = async () => students;
    repository.progressSemesters = async () => [{ semester: '1' }];
    outcomes.load = async (batch, ids, mode) => { calls.push({ batch, ids, mode }); return ids.length ? fixture(mode === 'effective' ? 'pass' : 'fail') : { courses: fixture().courses, results: [], subjects: [] }; };
    assert.equal((await service.getProgress({ batch_id: '9', mode: 'original' })).summary.uncleared, 1);
    assert.equal((await service.getProgress({ batch_id: '9' })).summary.withoutBacklog, 1);
    assert.equal(calls.length, 4); assert.ok(calls.every(c => c.batch === 9));
    outcomes.load = async () => { throw new Error('Database unavailable'); };
    await assert.rejects(service.getProgress({ batch_id: 9 }), /Database unavailable/);
  } finally {
    repository.batch = saved.batch; repository.progressStudentCount = saved.count; repository.progressStudents = saved.students; repository.progressSemesters = saved.terms; outcomes.load = saved.load;
  }
});

test('read-only MySQL overlay: only approved effective revaluation clears progress', { skip: process.env.REPORTS_DB_TEST !== '1' }, async () => {
  await db.sequelize.authenticate();
  const realQuery = db.sequelize.query.bind(db.sequelize);
  const fixtureSql = `WITH academic_courses AS (SELECT 1 course_id,1 batch_id,'1' semester,'C1' subject_code,'Course' subject_name,'active' status,1 is_required,1 roster_verified),
    batches AS (SELECT 1 batch_id,'Test' batch_name,2025 start_year,2027 end_year,NULL deleted_at),
    students AS (SELECT 1 student_id,1 batch_id,'U1' usn,'Student 1' student_name,NULL category,NULL deleted_at UNION ALL SELECT 2,1,'U2','Student 2',NULL,NULL UNION ALL SELECT 3,1,'U3','Student 3',NULL,NULL UNION ALL SELECT 4,1,'U4','Student 4',NULL,NULL),
    result_sessions AS (SELECT 1 session_id,1 batch_id,'1' semester,'Dec' exam_session,2025 exam_year,12 exam_start_month,2025 exam_start_year,12 exam_end_month,2025 exam_end_year UNION ALL SELECT 2,1,'1','Jun',2026,6,2026,6,2026),
    results AS (SELECT 1 result_id,1 student_id,1 session_id,1 attempt_no,'REGULAR' exam_type UNION ALL SELECT 2,2,1,1,'REGULAR' UNION ALL SELECT 3,3,1,1,'REGULAR' UNION ALL SELECT 4,4,1,1,'REGULAR' UNION ALL SELECT 5,4,2,1,'BACKLOG'),
    subjects AS (SELECT 1 subject_id,1 session_id,1 course_id,'C1' subject_code,4 credits,100 max_marks UNION ALL SELECT 2,2,1,'C1',4,100),
    subject_results AS (SELECT 1 subject_result_id,1 result_id,1 subject_id,30 marks,'fail' result_status,'F' grade,1 course_id_snapshot UNION ALL SELECT 2,2,1,30,'fail','F',1 UNION ALL SELECT 3,3,1,30,'fail','F',1 UNION ALL SELECT 4,4,1,30,'fail','F',1 UNION ALL SELECT 5,5,2,30,'fail','F',1),
    revaluation_results AS (SELECT 1 revaluation_id,1 subject_result_id,1 revaluation_no,1 is_effective,'approved' revaluation_status,60 revised_marks,'pass' revised_status,'B' revised_grade
      UNION ALL SELECT 2,2,1,1,'pending',60,'pass','B' UNION ALL SELECT 3,3,1,1,'rejected',60,'pass','B'
      UNION ALL SELECT 4,1,2,1,'pending',30,'fail','F'
      UNION ALL SELECT 5,5,1,1,'approved',60,'pass','B') `;
  let calls = 0;
  db.sequelize.query = (sql, options) => { calls++; assert.match(sql.trim(), /^SELECT\b/); return realQuery(fixtureSql + sql, options); };
  try {
    const population = [1, 2, 3, 4].map(student_id => ({ student_id, usn: String(student_id), student_name: 'Test' }));
    const original = await outcomes.load(1, [1, 2, 3, 4], 'original');
    const effective = await outcomes.load(1, [1, 2, 3, 4], 'effective');
    assert.equal(calls, 6, 'Three batched queries per mode');
    assert.equal(service.aggregate(original, population, { semester: 1 }).summary.uncleared, 4);
    const result = service.aggregate(effective, population, { semester: 1 });
    assert.equal(result.summary.withoutBacklog, 1); assert.equal(result.summary.uncleared, 2); assert.equal(result.summary.withBacklog, 1);
    assert.equal(result.summary.backlogStudents, 3); assert.equal(result.summary.clearanceRate, 33.33);
    assert.equal(effective.subjects.find(s => s.student_id === 1).marks, 30, 'Original marks remain unchanged');
    for (const studentId of [2, 3]) assert.equal(effective.subjects.find(s => s.student_id === studentId).outcome_status, 'fail');
    const response = await service.getProgress({ batch_id: '1', semester: '1', mode: 'effective' });
    assert.deepEqual(response.summary, result.summary, 'The public service returns the same canonical effective KPIs');
    assert.deepEqual(response.trends.map(t => [t.withoutBacklog, t.withBacklog, t.uncleared, t.unknown]), [[1, 1, 2, 0]]);
    assert.deepEqual(response.attention.map(s => s.usn), ['U2', 'U3'], 'Cleared students leave the attention list');
    const defaultResponse = await service.getProgress({ batch_id: '1', semester: '1' });
    assert.equal(defaultResponse.mode, 'effective');
    assert.deepEqual(defaultResponse.attention.map(s => s.usn), ['U2', 'U3'], 'The default view excludes students cleared by approved revaluation');
    assert.deepEqual(response.courses.map(c => [c.backlog, c.cleared, c.uncleared, c.clearanceRate]), [[3, 1, 2, 33.33]]);
    const year = await service.getProgress({ batch_id: '1', academic_year: '1', mode: 'effective' });
    assert.equal(year.summary.unknown, 4, 'A missing second semester still prevents year-level certification');
  } finally { db.sequelize.query = realQuery; }
});
