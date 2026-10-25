'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const wording = require('../public/js/reports/wording');

test('report summaries preserve identity metadata and move full explanations into details', () => {
  const context = [['Programme','MCA'], ['Batch','Example'], ['Semester',1], ['Exam Session','Dec 2025 / Jan 2026'], ['Result View','Effective Result'], ['GPA Basis',wording.gpa], ['SGPA Basis','Stored original'], ['Calculation details','Verified history remains separate.']];
  assert.deepEqual(wording.visible(context), context.slice(0,6));
  assert.deepEqual(wording.details({ context }), ['Verified history remains separate.']);
  for (const type of ['student','class','subject','revaluation','toppers','consolidated','result-analysis','student-progress']) {
    const report = { type, filters: { mode: 'effective' }, context: [] };
    const copy = wording.details(report).join(' ');
    if (['student','class','toppers','consolidated'].includes(type)) assert.match(copy, /not recalculated.*verified cumulative/s);
    if (type === 'consolidated') assert.match(copy, /No component is inferred/);
    if (type === 'revaluation') assert.match(copy, /Pending, rejected and approved non-effective events do not change/);
    if (type === 'subject') assert.match(copy, /original stored components/);
  }
});

test('screen, print and CSV retain calculation explanations without changing numeric cells', () => {
  const page = fs.readFileSync(require.resolve('../views/reports/partials/page.ejs'), 'utf8');
  const print = fs.readFileSync(require.resolve('../views/reports/print.ejs'), 'utf8');
  const service = fs.readFileSync(require.resolve('../services/reportsService'), 'utf8');
  const controller = fs.readFileSync(require.resolve('../controllers/reportsController'), 'utf8');
  assert.match(page, /<summary>Notes<\/summary>/);
  assert.ok(page.indexOf('/js/reports/wording.js') < page.indexOf('/js/reports/common.js'));
  assert.match(print, /reportWording\.details\(report, true\)/);
  assert.match(service, /yield \['Calculation details', detail\]/);
  assert.match(controller, /service.contextLines\(report\)/);
  for (const file of ['reports','analytics']) {
    const css = fs.readFileSync(require.resolve('../public/css/' + file + '.css'), 'utf8');
    assert.match(css, /summary.*var\(--text-primary\)/);
    assert.match(css, /summary:focus-visible/);
  }
});

test('Toppers uses short screen copy while retaining full export explanations and context data', () => {
  const report = { type: 'toppers', filters: { mode: 'original' }, context: [
    ['Programme', 'MCA'], ['Batch', 'MCA 2025'], ['Semester', 1], ['Exam Session', 'Dec 2025 / Jan 2026'],
    ['Result View', 'Original Result'], ['Ranking Basis', 'Stored original CGPA, descending'],
    ['GPA Basis', wording.gpa], ['Generated At', '2026-10-25'],
    ['Calculation details', 'Full original explanation remains available for export.']
  ] };
  const before = JSON.stringify(report);
  assert.deepEqual(wording.visible(report.context, report.type), [
    ['Batch', 'MCA 2025'], ['Semester', 1], ['Exam Session', 'Dec 2025 / Jan 2026'],
    ['Result View', 'Original Result'], ['Generated at', '2026-10-25']
  ]);
  const notes = wording.details(report, true);
  assert.ok(notes.every(note => note.length < 65));
  assert.deepEqual(notes, ['Original CGPA, highest first. Passed attempts only.']);
  assert.deepEqual(wording.details(report), ['Full original explanation remains available for export.']);
  assert.equal(JSON.stringify(report), before);
});

test('every report has essential screen/PDF context, a timestamp and at most two short notes', () => {
  for (const type of ['student', 'class', 'subject', 'revaluation', 'toppers', 'consolidated', 'result-analysis', 'student-progress']) {
    const report = { type, generatedAt: '2026-10-25T17:41:38Z', filters: { mode: 'effective' }, context: [
      ['Batch', 'MCA 2025'], ['Semester', 1], ['USN', 'TEST001'], ['Exam Session', 'Dec 2025 / Jan 2026'],
      ['Result View', 'Effective Result'], ['GPA Basis', 'Long GPA explanation'], ['Marks Basis', 'Long marks explanation'],
      ['Calculation details', 'Long calculation explanation'], ['Eligibility', 'Long eligibility explanation']
    ] };
    const before = JSON.stringify(report);
    const context = wording.visible(report.context, type, report.generatedAt);
    assert.deepEqual(context.slice(0, 5), report.context.slice(0, 5));
    assert.deepEqual(context.at(-1), ['Generated at', report.generatedAt]);
    assert.equal(context.filter(([label]) => label === 'Generated at').length, 1);
    const withTimestamp = wording.visible([...report.context, ['Generated At', report.generatedAt]], type, report.generatedAt);
    assert.equal(withTimestamp.filter(([label]) => label === 'Generated at').length, 1);
    const notes = wording.details(report, true);
    assert.ok(notes.length <= 2, type);
    assert.ok(notes.every(note => note.length < 100), type);
    assert.equal(JSON.stringify(report), before);
  }
});

test('chart labels translate missing grade only at presentation boundary and retain zero', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/analytics/charts'), 'utf8'), { window });
  assert.equal(window.AnalyticsCharts.gradeLabel('Unknown'), 'Grade unavailable');
  assert.equal(window.AnalyticsCharts.gradeLabel(null), 'Grade unavailable');
  assert.equal(window.AnalyticsCharts.gradeLabel('F'), 'F');
  assert.equal(window.AnalyticsCharts.formatValue(0, 2), '0.00');
  assert.notEqual(window.AnalyticsCharts.formatValue(null, 2), '0.00');
});

test('attempt counts and stored GPA headings identify the existing metric meaning', () => {
  for (const page of ['subjects', 'semesters']) {
    const template = fs.readFileSync(require.resolve('../views/analytics/' + page + '.ejs'), 'utf8');
    assert.match(template, />Result attempts<\/th>/);
    assert.doesNotMatch(template, />Students<\/th>/);
  }
  for (const page of ['overview', 'semesters']) {
    assert.match(fs.readFileSync(require.resolve('../views/analytics/' + page + '.ejs'), 'utf8'), /Average stored SGPA/);
  }
});
