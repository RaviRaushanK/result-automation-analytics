'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function render(data) {
  let page;
  const charts = new Map(), rows = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/analytics/semesters'), 'utf8'), {
    window: { AnalyticsPage(config) { page = config; } }, GpaFormat: require('../public/js/gpa-format')
  });
  page.render({data}, { row: row => rows.push(row), number: value => value, chart: (id, labels, datasets, presentation) => charts.set(id, {labels, datasets, presentation}) });
  return { chart: charts.get('semesters-gpa-chart'), passChart: charts.get('semesters-trend-chart'), rows };
}

test('session GPA bars retain a single backlog CGPA and leave missing SGPA unplotted', () => {
  const data = [
    {batchName:'Example',semester:1,examPeriod:'Dec 2025 / Jan 2026', resultCount:5, avgSgpa:7,avgCgpa:7},
    {batchName:'Example',semester:1,examPeriod:'May / Jun 2026', resultCount:1, avgSgpa:null,avgCgpa:0.89},
    {batchName:'Example',semester:2,examPeriod:'May / Jun 2026', resultCount:4, avgSgpa:6.5,avgCgpa:6.1}
  ];
  const original = JSON.stringify(data), {chart, passChart, rows} = render(data);
  assert.equal(passChart.presentation, undefined);
  assert.equal(chart.presentation, undefined);
  assert.deepEqual(Array.from(chart.datasets[0].data), [7,null,6.5]);
  assert.deepEqual(Array.from(chart.datasets[1].data), [7,0.89,6.1]);
  assert.ok(chart.datasets.every(dataset => dataset.type === 'bar' && dataset.tension === undefined));
  assert.deepEqual(Array.from(chart.labels[1]), ['Example | Sem 1','May / Jun 2026','1 result attempt']);
  assert.equal(rows[1][8], '—');
  assert.equal(rows[1][9], '0.89');
  assert.equal(JSON.stringify(data), original);
});

test('missing or invalid chart GPA stays null while valid zero and decimal values remain numeric', () => {
  const values = [null,undefined,'-','', ' ', 'invalid',{},false,0,'0','2.50'];
  const {chart} = render(values.map(value => ({avgSgpa:value, avgCgpa:value})));
  for (const dataset of chart.datasets) assert.deepEqual(Array.from(dataset.data), [null,null,null,null,null,null,null,null,0,0,2.5]);
});

test('screen report cells have room for full identifiers and names without changing print layout', () => {
  const source = fs.readFileSync(require.resolve('../public/js/reports/common'), 'utf8');
  const css = fs.readFileSync(require.resolve('../public/css/reports.css'), 'utf8');
  assert.match(source, /column.key === 'usn'\) td.classList.add\('reports-usn'\)/);
  assert.match(source, /column.key === 'student_name'\) td.classList.add\('reports-student-name'\)/);
  assert.match(css, /\.reports-page \.reports-table td\.reports-usn \{[^}]*white-space: nowrap;[^}]*word-break: normal/);
  assert.match(css, /@media screen\s*\{\s*\.reports-page\[data-report-type="revaluation"\] \.reports-table \{ width: max-content/);
  const template = fs.readFileSync(require.resolve('../views/analytics/semesters.ejs'), 'utf8');
  assert.match(template, /Missing GPA is not plotted/);
  assert.match(template, /not one student's progression/);
  assert.match(template, /<details[^>]*>\s*<summary>About these averages<\/summary>/);
});
