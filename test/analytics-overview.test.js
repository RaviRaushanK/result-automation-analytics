'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function overviewResponse() {
  const module = { exports: {} };
  const repository = {
    getSummary: async () => ({
      subject: { students: '2', results: '3', attempted: '4', passed: '3', failed: '1', avgMarks: '65' },
      parent: { resultTotal: '3', resultPassCount: '2', resultFailCount: '1', avgSgpa: '7.5', avgCgpa: '7' }
    }),
    getGradeDistribution: async () => [{ grade: null, count: '1' }, { grade: 'A', count: '3' }]
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/analyticsService.js'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === '../services/examSessionParameters') return require('../services/examSessionParameters');
      if (name === '../public/js/exam-period') return require('../public/js/exam-period');
      assert.equal(name, '../repositories/analyticsRepository');
      return repository;
    }
  });
  return module.exports.getOverview({ mode: 'effective' });
}

test('Overview service response contract', async () => {
  const response = await overviewResponse();
  console.log('Overview response:', JSON.stringify(response));
  assert.equal(response.mode, 'effective');
});

test('Analytics session options format structured ranges ahead of legacy month/year', async () => {
  const module = { exports: {} };
  const repository = { getFilterOptions: async () => [{ examSessionId: 1, examSession: 'Apr', examYear: 2026,
    examStartMonth: 12, examStartYear: 2025, examEndMonth: 1, examEndYear: 2026 }] };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/analyticsService.js'), 'utf8'), {
    module, exports: module.exports, require(name) {
      if (name === '../services/examSessionParameters') return require('../services/examSessionParameters');
      if (name === '../public/js/exam-period') return require('../public/js/exam-period');
      assert.equal(name, '../repositories/analyticsRepository'); return repository;
    }
  });
  for (const mode of ['original', 'effective']) {
    const result = await module.exports.getFilterOptions('sessions', { mode });
    assert.equal(result.data[0].examSession, 'Dec 2025 / Jan 2026');
    assert.equal(result.filters.mode, mode);
  }
});

test('Overview starts and renders the service response', async () => {
  const response = await overviewResponse();
  const elements = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      value: key === 'filter-mode' ? 'original' : key === 'filter-attempt' ? 'latest' : '',
      textContent: '', innerHTML: '', children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
      appendChild(child) { this.children.push(child); },
      querySelector() { return null; }
    });
    return elements.get(key);
  }
  const requests = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/analytics/overview.js'), 'utf8'), {
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: () => element(Symbol()), documentElement: { getAttribute: () => 'light' } },
    location: { search: '' }, URLSearchParams, console, setTimeout, GpaFormat: require('../public/js/gpa-format'),
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.includes('/filter-options/') ? { data: [] } : response };
    }
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(requests.some(url => url.startsWith('/analytics/api/overview')));
  assert.equal(element('[data-metric="students"] .stat-value').textContent, '2');
});
