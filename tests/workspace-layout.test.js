'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { base, pages, api } = require('./fixtures/workspace-pages');

for (const [name, [view, locals]] of Object.entries(pages)) {
  test(`${name} renders inside the responsive workspace scope`, async () => {
    const html = await ejs.renderFile(path.join(__dirname, '../views', view + '.ejs'), {
      ...base, ...locals, user: { role: 'admin' }
    });
    assert.match(html, /class="[^"]*workspace-page/);
    if (name === 'dashboard') {
      assert.match(html, /dashboard-chart-grid/);
      assert.equal((html.match(/<canvas /g) || []).length, 3);
      assert.match(html, /id="passFailPieChart"/);
      assert.doesNotMatch(html, /id="passFailDoughnutChart"|semesterPerformanceChart|Semester Performance/);
      assert.match(html, /id="gradeDistributionChart"/);
      assert.match(html, /id="dashboardAttentionBody"/);
    }
    if (name === 'roster-verified') {
      assert.match(html, /id="editRosterBtn"/);
      assert.doesNotMatch(html, /name="required_courses"/);
    }
    if (name === 'students') {
      assert.match(html, /id="studentFormModal"/);
      assert.match(html, /id="importModal"/);
    }
  });
}

test('responsive fixture API refuses writes and leaves unrelated requests alone', () => {
  let status, nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() {} };
  api({ method: 'POST', get: () => 'http://localhost/verification/workspace/students' }, res, () => {});
  assert.equal(status, 405);
  api({ method: 'GET', get: () => 'http://localhost/students' }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
