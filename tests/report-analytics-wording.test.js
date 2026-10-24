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
  assert.match(page, /<summary>Calculation details<\/summary>/);
  assert.ok(page.indexOf('/js/reports/wording.js') < page.indexOf('/js/reports/common.js'));
  assert.match(print, /label === 'Calculation details'/);
  assert.match(service, /yield \['Calculation details', detail\]/);
  assert.match(controller, /service.contextLines\(report\)/);
  for (const file of ['reports','analytics']) {
    const css = fs.readFileSync(require.resolve('../public/css/' + file + '.css'), 'utf8');
    assert.match(css, /summary.*var\(--text-primary\)/);
    assert.match(css, /summary:focus-visible/);
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
