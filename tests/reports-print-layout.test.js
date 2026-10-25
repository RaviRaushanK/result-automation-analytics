'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

function fixture(attempts = 1) {
  const subjects = Array.from({ length: 6 }, (_, i) => ({ code: 'MCA' + (i + 1), name: 'Subject ' + (i + 1) }));
  return { reportWording: require('../public/js/reports/wording'), report: { type: 'student', title: 'Student Result Report', branding: null, filters: { mode: 'original' },
    metrics: [['Subjects', 6]], columns: [{ key: 'code', label: 'Subject Code' }, { key: 'name', label: 'Subject Name' }], rows: subjects,
    semesters: [{ semester: '1', sessions: [{ session: { exam_session: 'Jun', exam_year: 2026 }, attempts: Array.from({ length: attempts }, (_, i) => ({ result: { attempt_no: i + 1, exam_type: i ? 'BACKLOG' : 'REGULAR' }, subjects, metrics: [['Subjects', 6]] })) }] }] },
    context: [['Student Name', 'TEST STUDENT'], ['GPA Basis', 'Stored original GPA']], display: (key, value) => value };
}

test('single-attempt student print combines headings and omits the duplicate attempt summary', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), fixture());
  assert.match(html, /Semester 1 &middot; Jun 2026 &middot; Attempt 1 - REGULAR/);
  assert.equal((html.match(/class="reports-summary"/g) || []).length, 1);
  assert.doesNotMatch(html, /<h3>|<h4>/);
  assert.equal((html.match(/<tbody>/g) || []).length, 1);
  for (let i = 1; i <= 6; i++) assert.match(html, new RegExp('MCA' + i));
  assert.match(html, /Marks: original values for each selected attempt\./);
});

test('multi-attempt student print preserves every attempt, per-attempt summary and subject table', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), fixture(2));
  assert.match(html, /Attempt 1 - REGULAR/);
  assert.match(html, /Attempt 2 - BACKLOG/);
  assert.equal((html.match(/class="reports-summary"/g) || []).length, 3);
  assert.equal((html.match(/<tbody>/g) || []).length, 2);
});

test('revaluation print protects the entire USN cell from mid-identifier wrapping', async () => {
  const locals = fixture();
  locals.report.type = 'revaluation';
  locals.report.title = 'Revaluation Report';
  locals.report.columns = [{key:'usn', label:'USN'}, {key:'student_name', label:'Student Name'}, {key:'original_marks',label:'Original total'}, {key:'revised_marks',label:'Revised total'}];
  locals.report.rows = [{usn:'TEST25MC074', student_name:'Example Student', original_marks:45, revised_marks:50}];
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), locals);
  assert.match(html, /<td class="reports-usn">TEST25MC074<\/td>/);
  assert.match(html, />45<\/td>.*>50<\/td>/s);
  const css = require('node:fs').readFileSync(path.join(__dirname,'../public/css/reports.css'),'utf8');
  assert.match(css, /td\.reports-usn\s*\{[^}]*white-space: nowrap;[^}]*overflow-wrap: normal;[^}]*word-break: normal/);
});

test('Toppers print keeps essential context and two short notes without duplicating long explanations', async () => {
  const locals = fixture();
  Object.assign(locals.report, { type: 'toppers', title: 'Toppers Report',
    metrics: [['Eligible Result Attempts', 3], ['Students', 3], ['Highest Stored CGPA', 7.89]],
    columns: [{ key: 'position', label: 'Rank' }, { key: 'student_name', label: 'Student Name' }, { key: 'cgpa', label: 'CGPA' }],
    rows: [{ position: 1, student_name: 'Test Student', cgpa: 7.89 }] });
  locals.context = [['Programme', 'MCA'], ['Batch', 'MCA 2025'], ['Semester', 1], ['Generated At', '2026-10-25T17:41:38.466Z'], ['Exam Session', 'Dec 2025 / Jan 2026'],
    ['Ranking Basis', 'Stored original CGPA, descending'], ['Eligibility', 'Stored passing result, non-NULL CGPA, no failed original subject rows'],
    ['Tie Order', 'USN, attempt number, result ID'], ['GPA Basis', 'Stored values; unchanged by revaluation.'],
    ['Calculation details', 'Long historical GPA explanation'], ['Calculation details', 'Rows represent result attempts']];
  const before = JSON.stringify(locals);
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), locals);
  assert.match(html, /MCA 2025/); assert.match(html, /Dec 2025 \/ Jan 2026/);
  assert.match(html, /Generated at<\/dt><dd>2026-10-25T17:41:38.466Z/);
  assert.equal((html.match(/class="reports-component-note"/g) || []).length, 2);
  assert.match(html, /Ranking: passed attempts, highest saved CGPA first\./);
  assert.doesNotMatch(html, /Eligibility|Tie Order|GPA Basis|Long historical|Rows represent|Eligible Result Attempts|Highest Stored CGPA/);
  assert.match(html, />Eligible attempts<\/span>/); assert.match(html, />Top CGPA<\/span>/);
  assert.match(html, /<td>1<\/td><td>Test Student<\/td><td>7\.89<\/td>/);
  assert.equal(JSON.stringify(locals), before);
});
