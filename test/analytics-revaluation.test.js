'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('Revaluation loads its shared browser helper before its renderer', () => {
  const template = fs.readFileSync(path.join(root, 'views/analytics/revaluation.ejs'), 'utf8');
  const scripts = Array.from(template.matchAll(/<script\s+src="(\/js\/analytics\/[^"\s]+)"\s*><\/script>/g), match => match[1]);
  const helper = scripts.indexOf('/js/analytics/page.js');
  const renderer = scripts.indexOf('/js/analytics/revaluation.js');
  assert.ok(helper >= 0, 'Revaluation must include /js/analytics/page.js');
  assert.ok(renderer > helper, 'The shared helper must load before the renderer');

  // Execute the local scripts in template order. No filter form deliberately
  // exercises the helper's supported no-form guard without a database or CDN.
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  for (const script of scripts) {
    vm.runInContext(fs.readFileSync(path.join(root, 'public', script.slice(1)), 'utf8'), context, { filename: script });
  }
  assert.equal(typeof context.window.AnalyticsPage, 'function');
});


function element() {
  return {
    children: [], value: '', disabled: false, attributes: {},
    set textContent(value) { this.valueText = String(value); this.children = []; },
    get textContent() { return this.valueText || this.children.map(child => child.textContent).join(''); },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {},
    classList: { remove() {}, toggle() {} }
  };
}

async function renderRevaluation(fail) {
  const nodes = Object.fromEntries(['revaluation-table-body', 'revaluation-integrity'].map(id => [id, element()]));
  const cards = Object.fromEntries(['pending', 'approved', 'rejected'].map(id => [id, element()]));
  const form = element();
  form.elements = [];
  form.elements.namedItem = () => null;
  nodes['analytics-filter-form'] = form;
  const urls = [];
  const context = vm.createContext({
    window: {}, location: { search: '' }, URLSearchParams, setTimeout, Node: class Node {},
    document: {
      getElementById: id => nodes[id] || null,
      createElement: () => element(),
      querySelector: selector => cards[selector.match(/pipeline-(\w+)/)[1]]
    },
    fetch: async url => {
      urls.push(url);
      return { ok: !fail, status: fail ? 500 : 200, json: async () => ({
        outcomes: { cases: 4, subjectsWithRevaluation: 3, statusChanges: 1,
          failToPass: 1, passToFail: 0, positiveDelta: 2, unchanged: 1,
          negativeDelta: 1, averageDelta: 2.5, maxDelta: 8, minDelta: -3 },
        pipeline: [{ revaluationStatus: 'approved', rowCount: 4 }],
        effectiveIntegrity: { effectiveOverlaySubjects: 3, anomalies: 1 }
      }) };
    }
  });
  for (const script of ['page.js', 'revaluation.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'public/js/analytics', script), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, cards, urls };
}

test('Revaluation renders aggregate outcomes, ledger counts and integrity', async () => {
  const { nodes, cards, urls } = await renderRevaluation(false);
  assert.deepEqual(urls, ['/analytics/api/revaluation?']);
  const rows = nodes['revaluation-table-body'].children;
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[0].children.map(cell => cell.textContent), ['Applied revaluations', '4']);
  assert.deepEqual(rows[10].children.map(cell => cell.textContent), ['Minimum change in marks', '-3']);
  assert.deepEqual(rows.map(row => row.children[1].textContent), ['4','3','1','1','0','2','1','1','2.5','8','-3']);
  assert.deepEqual(rows.slice(1, 10).map(row => row.children[0].textContent), [
    'Student subject results affected', 'Results with a changed status', 'Results changed from fail to pass',
    'Results changed from pass to fail', 'Results with increased marks', 'Results with unchanged marks',
    'Results with decreased marks', 'Average change in marks', 'Maximum change in marks'
  ]);
  assert.equal(cards.approved.textContent, '4');
  assert.equal(cards.pending.textContent, '0');
  assert.match(nodes['revaluation-integrity'].textContent, /with an applied revaluation: 3/);
  assert.match(nodes['revaluation-integrity'].textContent, /with more than one approved revaluation marked as applied: 1/);
  assert.equal(nodes['revaluation-table-body'].attributes['aria-busy'], 'false');
});

test('revaluation explanations distinguish filtered outcomes from collapsed system-wide checks', () => {
  const template = fs.readFileSync(path.join(root, 'views/analytics/revaluation.ejs'), 'utf8');
  assert.match(template, /Increase\/decrease counts show how many results changed/);
  assert.match(template, /effective total minus original total/);
  assert.match(template, /<details[^>]*>\s*<summary>System-wide integrity checks<\/summary>/);
  assert.match(template, /regardless of the filters above/);
  assert.match(template, /<p id="revaluation-integrity" role="status"><\/p>\s*<\/details>/);
});

test('Revaluation handles request failure without presenting stale counts', async () => {
  const { nodes, cards } = await renderRevaluation(true);
  assert.match(nodes['revaluation-table-body'].textContent, /Unable to load analytics data/);
  assert.equal(cards.approved.textContent, '\u2014');
  assert.equal(nodes['revaluation-integrity'].textContent, '');
  assert.equal(nodes['revaluation-table-body'].attributes['aria-busy'], 'false');
});
