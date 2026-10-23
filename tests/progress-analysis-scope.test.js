'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/progressAnalyticsService');
const repository = require('../repositories/reportsRepository');
const outcomes = require('../services/academicOutcomeService');
const policy = require('../services/academicPolicy');
const db = require('../database/models');
after(() => db.sequelize.close());

function cohort(start = 1) {
  const students = Array.from({ length: 8 }, (_, i) => ({ student_id: i + 1, usn: 'TEST' + (i + 1), student_name: 'Student ' + (i + 1) }));
  const courses = [1, 2, 3, 4].map(semester => ({ course_id: semester, semester: String(semester), subject_code: 'C' + semester,
    subject_name: 'Course ' + semester, status: 'active', is_required: true, roster_verified: true }));
  const data = { courses, results: [], subjects: [] };
  let nextId = 1;
  function sitting(student_id, term, outcome_status, retake = false) {
    const semester = start + term - 1;
    const row = { student_id, result_id: nextId++, exam_session_id: retake ? 100 + semester : semester,
      semester: String(semester), exam_type: retake ? 'BACKLOG' : 'REGULAR', attempt_no: retake ? 2 : 1,
      exam_session: retake ? 'Dec' : term === 1 ? 'Jan' : 'Jun', exam_year: retake ? 2028 : 2026 };
    data.results.push(row); data.subjects.push({ ...row, course_id: semester, outcome_status });
  }
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) sitting(id, 1, [2, 3, 5, 6, 7, 8].includes(id) ? 'fail' : 'pass');
  for (const id of [1, 2, 3, 5, 6]) sitting(id, 2, [5, 6].includes(id) ? 'fail' : 'pass');
  for (const id of [2, 5, 7]) sitting(id, 1, 'pass', true);
  sitting(5, 2, 'pass', true);
  return { data, students };
}
function aggregate(fixture, analysis_scope) {
  return service.aggregate(fixture.data, fixture.students, service.normalize({ batch_id: 1, analysis_scope }));
}

for (const start of [1, 3]) test(`study year ${Math.ceil(start / 2)} counts students once, certifies both semesters and keeps failures actionable`, () => {
  const f = cohort(start), before = JSON.stringify(f);
  const result = aggregate(f, 'year:' + Math.ceil(start / 2));
  assert.deepEqual(result.summary, { total: 8, withoutBacklog: 1, withBacklog: 2, uncleared: 3, unknown: 2, backlogStudents: 5, backlogCleared: 2, clearanceRate: 40 });
  assert.deepEqual(result.trends.map(t => t.semester), [start, start + 1]);
  assert.deepEqual(result.trends.map(t => t.total), [8, 5], 'Each semester bar uses its own participants');
  assert.equal(result.attentionTotal, 3);
  assert.equal(new Set(result.attention.map(row => row.studentId)).size, 3);
  const both = result.attention.find(row => row.studentId === 6);
  assert.match(both.unclearedCourses, new RegExp(`Semester ${start}: C${start}; Semester ${start + 1}: C${start + 1}`));
  assert.ok(result.attention.some(row => row.studentId === 8), 'Known failure is actionable even with the other semester missing');
  assert.ok(!result.attention.some(row => row.studentId === 7), 'Cleared first-semester backlog plus missing second semester stays unknown');
  assert.deepEqual(result.courses.map(row => [Number(row.semester), row.backlog, row.cleared, row.uncleared]), [[start, 6, 3, 3], [start + 1, 2, 1, 1]]);
  assert.equal(JSON.stringify(f), before, 'No original academic data was changed');
});

test('Semester 1 and Semester 2 summaries, backlog tables, attention and trends do not leak later work', () => {
  const f = cohort();
  const first = aggregate(f, 'semester:1'), second = aggregate(f, 'semester:2');
  assert.deepEqual(first.summary, { total: 8, withoutBacklog: 2, withBacklog: 3, uncleared: 3, unknown: 0, backlogStudents: 6, backlogCleared: 3, clearanceRate: 50 });
  assert.deepEqual(second.summary, { total: 8, withoutBacklog: 3, withBacklog: 1, uncleared: 1, unknown: 3, backlogStudents: 2, backlogCleared: 1, clearanceRate: 50 });
  assert.ok(first.courses.every(course => Number(course.semester) === 1));
  assert.ok(second.courses.every(course => Number(course.semester) === 2));
  assert.deepEqual(second.attention.map(row => row.studentId), [6]);
  assert.deepEqual(first.trends.map(row => row.semester), [1]);
  assert.deepEqual(second.trends.map(row => row.semester), [1, 2], 'Historical progression is retained through the selected scope');
});

test('same displayed course code in different semesters retains distinct stable course rows', () => {
  const f = cohort();
  f.data.courses.forEach(course => { course.subject_code = 'SAME'; });
  const result = aggregate(f, 'year:1');
  assert.equal(result.courses.length, 2);
  assert.deepEqual(result.courses.map(row => row.courseId).sort(), [1, 2]);
});

test('scope parser accepts old bookmarks but rejects conflicting, malformed and unsupported combinations', () => {
  assert.equal(service.normalize({ batch_id: 1, semester: 2 }).analysis_scope, 'semester:2');
  assert.equal(service.normalize({ batch_id: 1, academic_year: 1 }).analysis_scope, 'year:1');
  assert.equal(service.normalize({ batch_id: 1, semester: 2, analysis_scope: 'semester:2' }).semester, 2);
  for (const query of [
    { analysis_scope: 'semester:0' }, { analysis_scope: 'year:13' }, { analysis_scope: 'semester:25' },
    { analysis_scope: 'year:1', semester: 1 }, { analysis_scope: 'semester:2', academic_year: 1 },
    { analysis_scope: ['semester:1'] }, { analysis_scope: 'semester:1.5' }, { analysis_scope: 'year:01' },
    { analysis_scope: '' }, { scope_type: 'year', scope_value: 1 }, { mode: 'anything' },
  ]) assert.throws(() => service.normalize({ batch_id: 1, ...query }), error => error.status === 400);
});

async function withRepository(f, run, population = f.students) {
  const original = { batch: repository.batch, terms: repository.progressSemesters, count: repository.progressStudentCount, students: repository.progressStudents, load: outcomes.load };
  const calls = [];
  try {
    repository.batch = async () => ({ batch_id: 1, start_year: 2025, end_year: 2027 });
    repository.progressSemesters = async () => [...new Set(f.data.results.map(row => row.semester))].map(semester => ({ semester }));
    repository.progressStudentCount = async () => ({ total_rows: population.length });
    repository.progressStudents = async (filters, limit, offset) => population.slice(offset, offset + limit);
    outcomes.load = async (batch, ids, mode) => {
      calls.push({ ids, mode });
      const data = structuredClone(f.data);
      if (mode === 'effective') data.subjects.filter(row => row.student_id === 3 && row.semester === '1').forEach(row => { row.outcome_status = 'pass'; });
      return { courses: data.courses, results: data.results.filter(row => ids.includes(row.student_id)), subjects: data.subjects.filter(row => ids.includes(row.student_id)) };
    };
    return await run(calls);
  } finally {
    repository.batch = original.batch; repository.progressSemesters = original.terms; repository.progressStudentCount = original.count;
    repository.progressStudents = original.students; outcomes.load = original.load;
  }
}

test('public API binds scope availability to recorded participation and batch duration in both result modes', async () => {
  const f = cohort(), before = JSON.stringify(f);
  await withRepository(f, async calls => {
    const result = await service.getProgress({ batch_id: 1, analysis_scope: 'year:1', mode: 'original' });
    assert.deepEqual(result.semesters, [1, 2], 'Configured future Sem 3/4 courses do not create options');
    assert.deepEqual(result.years.map(row => row.year), [1]);
    assert.equal(result.summary.withoutBacklog, 1);
    assert.equal(result.filters.analysis_scope, 'year:1');
    const effective = await service.getProgress({ batch_id: 1, analysis_scope: 'year:1', mode: 'effective' });
    assert.equal(effective.summary.withoutBacklog, 2);
    assert.equal(effective.summary.uncleared, 2);
    assert.equal(effective.summary.clearanceRate, 50);
    const legacy = await service.getProgress({ batch_id: 1, semester: 1, mode: 'original' });
    assert.equal(legacy.label, 'Semester 1');
    const defaultScope = await service.getProgress({ batch_id: 1 });
    assert.equal(defaultScope.filters.analysis_scope, 'semester:2');
    const numberOfLoads = calls.length;
    for (const scope of ['semester:3', 'semester:5', 'year:2', 'year:3']) await assert.rejects(service.getProgress({ batch_id: 1, analysis_scope: scope }), error => error.status === 400);
    assert.equal(calls.length, numberOfLoads, 'Unavailable scopes are rejected before loading student histories');
  });
  assert.equal(JSON.stringify(f), before);
});

test('First Year missing second semester cannot certify clearance; verified failures still need attention', async () => {
  const f = cohort();
  f.data.results = f.data.results.filter(row => row.semester === '1');
  f.data.subjects = f.data.subjects.filter(row => row.semester === '1');
  await withRepository(f, async () => {
    const result = await service.getProgress({ batch_id: 1, analysis_scope: 'year:1', mode: 'original' });
    assert.equal(result.summary.withBacklog + result.summary.withoutBacklog, 0);
    assert.equal(result.summary.unknown, 5);
    assert.equal(result.summary.uncleared, 3);
    assert.deepEqual(result.trends.map(row => row.semester), [1]);
  });
});

test('batched study-year aggregation does not add semester populations or lose students at chunk boundaries', async () => {
  const f = cohort();
  const sourceResults = f.data.results.filter(row => row.student_id === 1), sourceSubjects = f.data.subjects.filter(row => row.student_id === 1);
  f.students = Array.from({ length: 501 }, (_, index) => ({ student_id: index + 1, usn: 'U' + index, student_name: 'Test' }));
  f.data.results = f.students.flatMap(student => sourceResults.map(row => ({ ...row, student_id: student.student_id })));
  f.data.subjects = f.students.flatMap(student => sourceSubjects.map(row => ({ ...row, student_id: student.student_id })));
  await withRepository(f, async calls => {
    const result = await service.getProgress({ batch_id: 1, analysis_scope: 'year:1', mode: 'original' });
    assert.equal(result.summary.total, 501);
    assert.equal(result.summary.withoutBacklog, 501);
    assert.deepEqual(calls.map(call => call.ids.length), [500, 1]);
    assert.deepEqual(result.trends.map(row => row.total), [501, 501]);
  });
});

test('no participation gives no future options or fabricated trends and retains the batch population as unknown', async () => {
  const f = cohort(); f.data.results = []; f.data.subjects = [];
  await withRepository(f, async () => {
    const result = await service.getProgress({ batch_id: 1 });
    assert.equal(result.summary.total, 8); assert.equal(result.summary.unknown, 8);
    assert.deepEqual(result.semesters, []); assert.deepEqual(result.years, []); assert.deepEqual(result.trends, []);
    assert.equal(result.summary.clearanceRate, null);
  });
});

test('configured batch duration excludes out-of-range historical semester values from public scopes', async () => {
  const f = cohort();
  f.data.results.push({ ...f.data.results[0], result_id: 999, semester: '5' });
  await withRepository(f, async () => {
    const result = await service.getProgress({ batch_id: 1 });
    assert.deepEqual(result.semesters, [1, 2]);
    await assert.rejects(service.getProgress({ batch_id: 1, analysis_scope: 'semester:5' }), error => error.status === 400);
    await assert.rejects(service.getProgress({ batch_id: 1, analysis_scope: 'year:3' }), error => error.status === 400);
  });
});

test('Second Year is offered when recorded Sem 3/4 participation exists and aggregates those semesters only', async () => {
  await withRepository(cohort(3), async () => {
    const result = await service.getProgress({ batch_id: 1, analysis_scope: 'year:2', mode: 'original' });
    assert.equal(result.label, 'Second Year');
    assert.deepEqual(result.scopeSemesters, ['3', '4']);
    assert.equal(result.summary.total, 8);
    assert.equal(result.summary.withBacklog, 2);
    assert.deepEqual(result.trends.map(row => row.semester), [3, 4]);
    assert.ok(result.courses.every(row => ['3', '4'].includes(row.semester)));
  });
});
