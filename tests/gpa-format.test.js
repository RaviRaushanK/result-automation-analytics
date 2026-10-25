'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const formatter = require('../public/js/gpa-format');
const { base, pages } = require('./fixtures/result-management-pages');
const reports = require('../services/reportsService');
after(() => require('../database/models').sequelize.close());
const render = (page, locals = {}) => ejs.renderFile(path.join(__dirname, '../views', pages[page][0] + '.ejs'),
  { ...base, ...pages[page][1], ...locals });

test('shared browser/server formatter safely handles decimals, missing/invalid input and legitimate zero', () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/gpa-format'), 'utf8'), browser);
  for (const [value, expected] of [[7, '7.00'], [6, '6.00'], [2.5, '2.50'], [1.77, '1.77'], [8.4, '8.40'],
    [0, '0.00'], ['0.00', '0.00'], ['7.00', '7.00'], [' 2.5 ', '2.50'], [10, '10.00']]) {
    assert.equal(formatter.format(value), expected);
    assert.equal(browser.window.GpaFormat.format(value), expected);
  }
  for (const value of [null, undefined, '', ' ', '\t', NaN, Infinity, -Infinity, 'invalid', 'NaN', 'Infinity',
    '7abc', '=1+1', '0x10', [], [7], {}, true, false]) {
    assert.equal(formatter.format(value, 'Unavailable'), 'Unavailable');
    assert.equal(browser.window.GpaFormat.format(value, '-'), '-');
  }
});

for (const exam_type of ['REGULAR', 'BACKLOG']) {
  test(`${exam_type}: Preview and saved result display two decimal places without changing values`, async () => {
    for (const [sgpa, cgpa, expectedSgpa, expectedCgpa] of [[7, 7, '7.00', '7.00'], [2.5, 1.77, '2.50', '1.77']]) {
      const data = { ...pages.preview[1].data, sgpa, cgpa };
      const before = JSON.stringify(data);
      const preview = await render('preview', { data, attempt: { exam_type, attempt_no: exam_type === 'REGULAR' ? 1 : 2 }, requiresRevalidation: false });
      assert.match(preview, new RegExp('<span class="fs-4 fw-bold">' + expectedSgpa.replace('.', '\\.') + '</span>'));
      assert.match(preview, new RegExp('id="previewCumulativeCgpa">' + expectedCgpa.replace('.', '\\.') + '</span>'));
      const saved = await render('success', { examType: exam_type, sgpa, cgpa });
      assert.ok(saved.includes('>' + expectedSgpa + '</div>'));
      assert.ok(saved.includes('>' + expectedCgpa + '</div>'));
      assert.equal(JSON.stringify(data), before);
      assert.equal(typeof data.sgpa, 'number'); assert.equal(typeof data.cgpa, 'number');
    }
  });
}

test('missing GPA remains unavailable in Preview, saved results and revaluation; legitimate zero is formatted', async () => {
  for (const value of [null, undefined, '', ' ', 'invalid']) {
    const preview = await render('preview', { data: { ...pages.preview[1].data, sgpa: value, cgpa: value } });
    assert.match(preview, /<span class="fs-4 fw-bold">-<\/span>/);
    assert.match(preview, /id="previewCumulativeCgpa">Unavailable<\/span>/);
    const saved = await render('success', { sgpa: value, cgpa: value });
    assert.equal((saved.match(/import-success-value">Unavailable/g) || []).length, 2);
    const outcome = await render('outcome', {
      origResult: { ...pages.outcome[1].origResult, sgpa: value, cgpa: value },
      aggregates: { ...pages.outcome[1].aggregates, sgpa: value, cgpa: value }
    });
    assert.doesNotMatch(preview + saved + outcome, /0\.00|NaN|Infinity/);
  }
  assert.match(await render('success', { sgpa: 0, cgpa: 0 }), /import-success-value">0\.00/);
});

test('revaluation preserves original/effective GPA meanings while formatting review, outcome and attempt history', async () => {
  const input = {
    origResult: { ...pages.outcome[1].origResult, sgpa: 7, cgpa: 2.5 },
    aggregates: { ...pages.outcome[1].aggregates, sgpa: 1.77, cgpa: 8.4 }
  };
  const before = JSON.stringify(input), html = await render('outcome', input);
  assert.match(html, /Historical Result row: SGPA 7\.00/);
  assert.match(html, /CGPA 2\.50/);
  assert.match(html, /Effective Calculated Attempt SGPA<\/small><span[^>]*>1\.77/);
  assert.match(html, /Effective Attempt GPA \(passed courses\)<\/small><span[^>]*>8\.40/);
  assert.equal(JSON.stringify(input), before);
  const review = await render('locked', { review: { ...pages.locked[1].review,
    aggregate_preview: { overall_result: 'pass', sgpa: 7, cgpa: 2.5, failed_subject_count: 0 } } });
  assert.match(review, /SGPA 7\.00/); assert.match(review, /CGPA 2\.50/);
  const attempts = await render('attempts', { attempts: [{ ...pages.attempts[1].attempts[0], sgpa: 7, cgpa: 7 }] });
  assert.equal((attempts.match(/class="text-end">7\.00<\/td>/g) || []).length, 2);
});

test('student and semester Analytics format GPA cells while leaving API/chart data numeric', () => {
  for (const page of ['students', 'semesters']) {
    let config; const rows = [], chartData = [];
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/analytics/' + page), 'utf8'), {
      window: { AnalyticsPage(value) { config = value; } }, GpaFormat: formatter
    });
    const data = [{ sgpa: 7, cgpa: 2.5, avgSgpa: 7, avgCgpa: 2.5 }], before = JSON.stringify(data);
    config.render({ data }, { row(value) { rows.push(value); }, number: value => value,
      statusBadge: value => value, chart(id, labels, datasets) { chartData.push(...datasets.flatMap(row => row.data)); } });
    assert.ok(rows[0].includes('7.00')); assert.ok(rows[0].includes('2.50'));
    assert.equal(JSON.stringify(data), before);
    assert.ok(chartData.every(value => value === undefined || typeof value === 'number'));
  }
});

test('reports share safe GPA formatting across print, browser tables, summaries and CSV exports', async () => {
  const source = fs.readFileSync(require.resolve('../public/js/reports/common'), 'utf8');
  const context = { GpaFormat: formatter };
  vm.runInNewContext(source.slice(source.indexOf('  function display('), source.indexOf('  function node(')) + '\nglobalThis.displayGpa = display;', context);
  for (const key of ['sgpa', 'cgpa', 'latest_cgpa', 'semester_1_sgpa', 'avgSgpa', 'Highest Stored CGPA']) {
    for (const value of [7, 2.5, 1.77, 0, null, undefined, '', ' ', 'invalid']) {
      assert.equal(reports.display(key, value), formatter.format(value, '-'));
      assert.equal(context.displayGpa(key, value), formatter.format(value, '-'));
    }
  }
  assert.equal(reports.csvReportCell('sgpa', 7), '"=""7.00"""');
  assert.equal(reports.csvReportCell('cgpa', 2.5), '"=""2.50"""');
  assert.equal(reports.csvReportCell('cgpa', ' '), '-');
  const report = { type: 'class', title: 'GPA display', filters: { mode: 'original' }, branding: null,
    metrics: [['SGPA', 7], ['Highest Stored CGPA', 2.5]],
    columns: [{ key: 'sgpa', label: 'SGPA' }, { key: 'cgpa', label: 'CGPA' }], rows: [{ sgpa: 7, cgpa: 1.77 }] };
  const before = JSON.stringify(report);
  const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), { reportWording: require('../public/js/reports/wording'), report, context: [], display: reports.display });
  assert.match(html, /<strong>7\.00<\/strong>/); assert.match(html, /<strong>2\.50<\/strong>/);
  assert.match(html, /<td>7\.00<\/td>/); assert.match(html, /<td>1\.77<\/td>/);
  assert.equal(JSON.stringify(report), before);
});

test('Result GPA model fields remain nullable database decimals and formatter is exposed only to views', () => {
  const { DataTypes } = require('sequelize');
  const attributes = require('../database/models/Result')({ define(name, fields) { return fields; } }, DataTypes);
  for (const key of ['sgpa', 'cgpa']) {
    assert.equal(attributes[key].type.toSql(), 'DECIMAL(4,2)');
    assert.equal(attributes[key].allowNull, true);
  }
  assert.match(fs.readFileSync(require.resolve('../app'), 'utf8'), /app\.locals\.formatGpa = require\('\.\/public\/js\/gpa-format'\)\.format/);
  assert.match(fs.readFileSync(path.join(__dirname, '../views/partials/head.ejs'), 'utf8'), /src="\/js\/gpa-format.js"/);
});
