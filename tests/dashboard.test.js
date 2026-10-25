'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Op } = require('sequelize');

function fixture({ empty = false, zero = false, gradeRows } = {}) {
  const calls = [];
  const track = (model, method, response) => async query => { calls.push({ model, method, query }); return response; };
  const models = {
    Batch: { findAll: track('Batch', 'findAll', [{ batch_id: 1, batch_name: 'MCA 2025' }]) },
    ExamSession: { findAll: track('ExamSession', 'findAll', empty ? [] : [{ exam_session_id: 10, batch_id: 1, semester: '2' }, { exam_session_id: 11, batch_id: 1, semester: '10' }]) },
    Student: {}, Subject: { count: track('Subject', 'count', empty ? 0 : 2) },
    SubjectResult: {
      max: (field, query) => track('SubjectResult', 'max', empty ? null : zero ? 0 : 150)(query),
      findAll: async query => {
        calls.push({ model: 'SubjectResult', method: 'findAll', query });
        if (empty) return [];
        if (query.group.includes('SubjectResult.grade')) return gradeRows || [{ grade: 'O', count: '2' }, { grade: 'A+', count: '1' }, { grade: 'F', count: '1' }];
        return [{ subject_id: 1, subject_code: 'MCA101', subject_name: 'Course', max_marks: '150', average_marks: '100.125', attempted: '4', passed: '3', failed: '1' }];
      }
    },
    Result: {
      count: async query => { calls.push({ model: 'Result', method: 'count', query }); return empty ? 0 : query.distinct ? 3 : query.where.result_status === 'pass' ? 3 : 1; },
      findOne: track('Result', 'findOne', { avgCgpa: empty ? null : zero ? '0.00' : '8.25' }),
      findAll: async query => {
        calls.push({ model: 'Result', method: 'findAll', query });
        if (empty) return [];
        return query.limit ? [{ exam_session_id: 10, attempt_no: 1, sgpa: '9.00', cgpa: '9.00', result_status: 'pass', Student: { student_id: 5, batch_id: 1, student_name: 'STUDENT', usn: 'TEST001' } }] : [
          { semester: '10', attempted: '2', passed: '2', failed: '0' }, { semester: '2', attempted: '2', passed: '1', failed: '1' }
        ];
      }
    }
  };
  const context = { module: { exports: {} }, console: { error() {} }, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/dashboardController'), 'utf8'), context);
  return { calls, controller: context.module.exports };
}
async function request(controller, action, query) {
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await controller[action]({ query }, response);
  return response;
}

test('dashboard uses the same session scope for metrics, subject results, and grade distribution', async () => {
  const f = fixture();
  const response = await request(f.controller, 'analytics', { batch_id: '1', semester: '2' });
  assert.equal(response.code, 200);
  const data = response.body.data;
  assert.equal(data.statistics.totalStudents, 3);
  assert.equal(data.statistics.totalPass, 3);
  assert.equal(data.statistics.passPercentage, 75);
  assert.equal(data.statistics.highestScore, 150);
  assert.equal(data.subjectAverages[0].average_marks, 100.13);
  assert.equal(data.subjectAverages[0].pass_percentage, 75);
  assert.deepEqual(Array.from(data.gradeDistribution, row => row.grade), ['O', 'A+', 'A', 'B+', 'B', 'C', 'F']);
  assert.equal(data.gradeDistribution[0].percentage, 50);
  assert.equal(data.gradeSummary.total, 4);
  assert.equal(data.semesterPerformance, undefined);
  assert.equal(data.basis, 'original'); assert.equal(data.attempt, 'all');
  const sessions = f.calls.find(c => c.model === 'ExamSession');
  assert.equal(sessions.query.where.batch_id, 1); assert.equal(sessions.query.where.semester, '2');
  const subjects = f.calls.find(c => c.model === 'SubjectResult' && c.method === 'findAll');
  assert.equal(subjects.query.include.length, 2);
  for (const include of subjects.query.include) assert.deepEqual(Array.from(include.where.exam_session_id[Op.in]), [10, 11]);
  const gradeQuery = f.calls.find(c => c.query?.group?.includes('SubjectResult.grade')).query;
  for (const include of gradeQuery.include) assert.deepEqual(Array.from(include.where.exam_session_id[Op.in]), [10, 11]);
});

test('batch with no sessions never falls back to all results across any dashboard endpoint', async () => {
  const f = fixture({ empty: true });
  for (const action of ['analytics', 'topScorers', 'passFail']) {
    const response = await request(f.controller, action, { batch_id: '999' });
    assert.equal(response.code, 200);
    if (action === 'analytics') {
      assert.equal(response.body.data.statistics.totalStudents, 0);
      assert.equal(response.body.data.statistics.averageCGPA, null);
      assert.equal(response.body.data.statistics.highestScore, null);
      assert.equal(response.body.data.subjectAverages.length, 0);
      assert.equal(response.body.data.gradeDistribution.length, 0);
      assert.equal(response.body.data.gradeSummary.total, 0);
    }
  }
  for (const call of f.calls.filter(c => c.query?.where?.exam_session_id)) assert.equal(call.query.where.exam_session_id[Op.in].length, 0);
  for (const call of f.calls.filter(c => c.model === 'SubjectResult')) {
    for (const include of call.query.include) assert.equal(include.where.exam_session_id[Op.in].length, 0);
  }
});

test('grade distribution retains legacy grades, combines case/whitespace, and exposes missing values', async () => {
  const f = fixture({ gradeRows: [{ grade: 'a+', count: '2' }, { grade: ' A+ ', count: '1' }, { grade: 'S', count: '2' }, { grade: 'F', count: '1' }, { grade: null, count: '1' }, { grade: ' ', count: '1' }] });
  const response = await request(f.controller, 'analytics', { batch_id: '1', semester: '2' });
  const data = response.body.data;
  assert.equal(data.gradeDistribution.find(row => row.grade === 'A+').count, 3);
  assert.equal(data.gradeDistribution.find(row => row.grade === 'S').count, 2);
  assert.equal(data.gradeDistribution.find(row => row.grade === 'Not recorded').count, 2);
  assert.equal(data.gradeSummary.graded, 6); assert.equal(data.gradeSummary.missing, 2); assert.equal(data.gradeSummary.total, 8);
  assert.equal(data.gradeDistribution.reduce((sum, row) => sum + row.count, 0), 8);
});

test('all-missing grades are shown as missing, never inferred from marks or pass status', async () => {
  const f = fixture({ gradeRows: [{ grade: null, count: '3' }] });
  const response = await request(f.controller, 'analytics', { batch_id: '1' });
  const data = response.body.data;
  assert.equal(data.gradeSummary.graded, 0);
  assert.equal(data.gradeSummary.missing, 3);
  assert.equal(data.gradeDistribution.find(row => row.grade === 'F').count, 0);
  assert.equal(data.gradeDistribution.find(row => row.grade === 'Not recorded').percentage, 100);
});

test('valid zero GPA and marks remain zero, not unavailable', async () => {
  const f = fixture({ zero: true });
  const response = await request(f.controller, 'analytics', { batch_id: '1' });
  assert.equal(response.body.data.statistics.highestScore, 0);
  assert.equal(response.body.data.statistics.averageCGPA, 0);
});

test('top scorer drill-down retains student, batch, session and passed-with-CGPA policy', async () => {
  const f = fixture();
  const response = await request(f.controller, 'topScorers', { batch_id: '1' });
  const call = f.calls.find(c => c.model === 'Result');
  assert.equal(call.query.where.result_status, 'pass');
  assert.equal(call.query.where.cgpa[Op.ne], null);
  assert.equal(call.query.include[0].required, true);
  assert.equal(response.body.data[0].student_id, 5);
  assert.equal(response.body.data[0].exam_session_id, 10);
});

test('invalid filters are rejected before any database query', async () => {
  for (const action of ['analytics', 'topScorers', 'passFail']) for (const query of [{ batch_id: '-1' }, { batch_id: '1 OR 1=1' }, { semester: 'n/a' }, { exam_session_id: '-1' }, { exam_session_id: 'invalid' }, { exam_session_id: '9007199254740992' }]) {
    const f = fixture();
    const response = await request(f.controller, action, query);
    assert.equal(response.code, 400);
    assert.equal(f.calls.length, 0);
  }
});

test('exam session intersects batch and semester on every dashboard endpoint', async () => {
  for (const action of ['analytics', 'topScorers', 'passFail']) {
    const f = fixture();
    const response = await request(f.controller, action, { batch_id: '1', semester: '2', exam_session_id: '10' });
    assert.equal(response.code, 200);
    const { where } = f.calls.find(c => c.model === 'ExamSession').query;
    assert.equal(where.batch_id, 1);
    assert.equal(where.semester, '2');
    assert.equal(where.exam_session_id, 10);
  }
});

test('subject averages combine session-specific subject records by code and count distinct courses', async () => {
  const f = fixture();
  await request(f.controller, 'analytics', { batch_id: '1', semester: '2' });
  const query = f.calls.find(c => c.model === 'SubjectResult' && c.query?.group?.includes('Subject.subject_code')).query;
  assert.deepEqual(Array.from(query.group), ['Subject.subject_code']);
  const average = query.attributes.find(a => a[1] === 'average_marks')[0];
  assert.equal(average.fn, 'AVG');
  assert.equal(average.args[0].col, 'SubjectResult.marks');
  const count = f.calls.find(c => c.model === 'Subject' && c.method === 'count').query;
  assert.equal(count.distinct, true);
  assert.equal(count.col, 'subject_code');
});

test('dashboard session options follow batch and semester and clear incompatible selections', () => {
  class Select {
    constructor() { this.options = []; this.value = ''; this.dataset = {}; }
    add(option) { this.options.push(option); if (this.options.length === 1) this.value = String(option.value); }
    replaceChildren(...options) { this.options = options; this.value = String(options[0]?.value || ''); }
    addEventListener() {}
    get selectedOptions() { return this.options.filter(o => String(o.value) === this.value); }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Select()); return elements.get(id); };
  get('dashboardFilters').dataset = {
    batches: JSON.stringify([{ batch_id: 1, batch_name: 'MCA 2025' }, { batch_id: 2, batch_name: 'MCA 2024' }]),
    batchSemesters: JSON.stringify([{ batch_id: 1, semester: 1 }, { batch_id: 1, semester: 2 }, { batch_id: 2, semester: 1 }]),
    examSessions: JSON.stringify([
      { exam_session_id: 10, batch_id: 1, semester: 1, label: 'Jan 2026' },
      { exam_session_id: 11, batch_id: 1, semester: 1, label: 'Jun 2026' },
      { exam_session_id: 12, batch_id: 1, semester: 2, label: 'Oct 2026' },
      { exam_session_id: 20, batch_id: 2, semester: 1, label: 'Jan 2025' }
    ])
  };
  const context = {
    document: { addEventListener: (event, callback) => callback(), querySelector: () => ({ dataset: {} }), getElementById: get },
    Option: function (textContent, value) { return { textContent, value: String(value) }; },
    URLSearchParams, location: { search: '?batch_id=1&semester=1&exam_session_id=11' },
    MutationObserver: class { observe() {} }
  };
  const source = fs.readFileSync(require.resolve('../public/js/dashboard.js'), 'utf8')
    .replace(/    loadDashboard\(\);\s*\}\);\s*$/, '    globalThis.hooks = { scope, semesterOptions, sessionOptions };\n});');
  vm.runInNewContext(source, context);
  const session = get('filterSession');
  assert.deepEqual(session.options.map(o => o.value), ['', '10', '11']);
  assert.equal(context.hooks.scope().exam_session_id, '11');
  get('filterSemester').value = '2';
  context.hooks.sessionOptions('11');
  assert.equal(session.value, '');
  assert.deepEqual(session.options.map(o => o.value), ['', '12']);
  get('filterBatch').value = '2';
  context.hooks.semesterOptions('2');
  context.hooks.sessionOptions('12');
  assert.equal(get('filterSemester').value, '');
  assert.equal(session.value, '');
  assert.deepEqual(session.options.map(o => o.value), ['', '20']);
});
