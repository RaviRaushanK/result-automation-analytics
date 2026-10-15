'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

function fixture(attempts = 1) {
  const subjects = Array.from({ length: 6 }, (_, i) => ({ code: 'MCA' + (i + 1), name: 'Subject ' + (i + 1) }));
  return { report: { type: 'student', title: 'Student Result Report', branding: null, filters: { mode: 'original' },
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
  assert.match(html, /class="reports-context-note"/);
});

test('multi-attempt student print preserves every attempt, per-attempt summary and subject table', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), fixture(2));
  assert.match(html, /Attempt 1 - REGULAR/);
  assert.match(html, /Attempt 2 - BACKLOG/);
  assert.equal((html.match(/class="reports-summary"/g) || []).length, 3);
  assert.equal((html.match(/<tbody>/g) || []).length, 2);
});
