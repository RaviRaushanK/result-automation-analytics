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
    document: { getElementById: element, querySelector: element, createElement: () => element(Symbol()), documentElement: { getAttribute: () => 'light' } },
    URLSearchParams, console, setTimeout,
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.includes('/filter-options/') ? { data: [] } : response };
    }
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(requests.some(url => url.startsWith('/analytics/api/overview')));
  assert.equal(element('[data-metric="students"] .stat-value').textContent, '2');
});
