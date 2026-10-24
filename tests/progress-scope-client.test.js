'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser(search = '?batch_id=1&semester=1', overrides = {}) {
  class Element {
    constructor(tag = 'div', value = '') { this.tagName = tag.toUpperCase(); this.children = []; this.handlers = {}; this.attributes = {}; this._value = String(value); }
    append(...children) { this.children.push(...children); }
    add(option) { this.append(option); }
    replaceChildren(...children) { this.children = children; this._value = ''; }
    get options() { return this.children.flatMap(child => child.tagName === 'OPTGROUP' ? child.children : child.tagName === 'OPTION' ? [child] : []); }
    get value() { return this.tagName === 'SELECT' ? (this.options.some(option => option.value === this._value) ? this._value : this.options[0]?.value || '') : this._value; }
    set value(value) { this._value = String(value); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, handler) { this.handlers[event] = handler; }
  }
  class Option extends Element { constructor(label, value) { super('option', value); this.textContent = label; } }
  const elements = new Map(), charts = new Map(), requests = [];
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element(['progress-batch', 'progress-scope', 'progress-mode'].includes(id) ? 'select' : 'div'));
    return elements.get(id);
  };
  get('progress-mode').append(new Option('Original', 'original'), new Option('Effective', 'effective'));
  const location = { search, pathname: '/analytics/progress', hash: '' };
  const history = { state: null, replaceState(state, title, url) { this.url = url; location.search = new URL(url, 'http://localhost').search; } };
  const context = {
    URLSearchParams, setTimeout, console, Node: Element, Option, location, history,
    document: { getElementById: get, createElement: tag => new Element(tag) },
    AnalyticsCharts: { destroy: id => charts.delete(id), render: (id, data) => charts.set(id, data) },
    fetch: async url => {
      requests.push(url);
      if (url.includes('filter-options/batches')) return { ok: true, json: async () => ({ data: [{ batchId: 1, batchName: 'MCA 2025' }] }) };
      const query = new URL(url, 'http://localhost').searchParams;
      const scope = query.get('analysis_scope') || (query.has('academic_year') ? 'year:' + query.get('academic_year') : 'semester:' + (query.get('semester') || 2));
      const label = scope === 'year:1' ? 'First Year' : 'Semester ' + scope.split(':')[1];
      const summary = scope === 'year:1' ? { total: 4, withoutBacklog: 1, withBacklog: 1, uncleared: 1, unknown: 1, backlogStudents: 2, backlogCleared: 1, clearanceRate: 50 }
        : { total: 4, withoutBacklog: 2, withBacklog: 0, uncleared: 1, unknown: 1, backlogStudents: 1, backlogCleared: 0, clearanceRate: 0 };
      Object.assign(summary, overrides);
      return { ok: true, json: async () => ({ success: true, label, summary, mode: query.get('mode'),
        description: 'Verified scope: ' + label, semesters: [1, 2], years: [{ year: 1, label: 'First Year' }],
        filters: { batch_id: 1, analysis_scope: scope }, attention: [{ studentId: 1, usn: 'TEST1', name: 'Student', period: label, unclearedCourses: 'C1', latestAttempt: 'Dec 2025 / REGULAR / Attempt 1' }], attentionTotal: 1, courses: [],
        trends: [1, 2].filter(term => scope !== 'semester:1' || term === 1).map(term => ({ label: 'Semester ' + term, withoutBacklog: 1, withBacklog: 1, uncleared: 1, unknown: 1 })) }) };
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/analytics/progress'), 'utf8'), context);
  return { get, charts, requests, history, async idle() {
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setImmediate(resolve));
      if (get('progress-filters').attributes['aria-busy'] === 'false') return;
    }
    assert.fail('Progress client did not finish loading');
  } };
}

test('grouped scope selector, cards, status chart title/ARIA and trend bars follow the same applied scope', async () => {
  const f = browser(); await f.idle();
  assert.deepEqual(f.get('progress-scope').children.map(group => group.label), ['Semesters', 'Study Years']);
  assert.deepEqual(f.get('progress-scope').options.map(option => option.value), ['semester:1', 'semester:2', 'year:1']);
  assert.equal(f.get('progress-scope').value, 'semester:1');
  assert.equal(f.get('progress-summary-heading').textContent, 'Semester 1 Completion');
  assert.equal(f.get('progress-status-heading').textContent, 'Semester 1 Completion Status');
  assert.equal(f.get('progress-status-chart').attributes['aria-label'], 'Semester 1 Completion Status');
  assert.deepEqual(Array.from(f.charts.get('progress-trend-chart').labels), ['Semester 1']);
  assert.match(f.history.url, /analysis_scope=semester%3A1/);
  assert.doesNotMatch(f.history.url, /[?&]semester=/);
  f.get('progress-scope').value = 'year:1';
  await f.get('progress-scope').handlers.change(); await f.idle();
  assert.match(f.requests.at(-1), /analysis_scope=year%3A1/);
  assert.equal(f.get('progress-summary-heading').textContent, 'First Year Completion');
  assert.equal(f.get('progress-status-heading').textContent, 'First Year Completion Status');
  assert.equal(f.get('progress-status-chart').attributes['aria-label'], 'First Year Completion Status');
  assert.equal(f.get('progress-total').textContent, '4');
  assert.equal(f.get('progress-scope-description').textContent, 'Verified scope: First Year');
  assert.equal(f.get('progress-attention-body').children[0].children[2].textContent, 'First Year');
  assert.deepEqual(Array.from(f.charts.get('progress-status-chart').datasets[0].data), [1, 1, 1, 1]);
  assert.deepEqual(Array.from(f.charts.get('progress-trend-chart').labels), ['Semester 1', 'Semester 2']);
  assert.match(f.charts.get('progress-status-chart').labels[3], /Not determined/);
});

test('page template uses Analysis Scope consistently without introducing another filter', () => {
  const template = fs.readFileSync(require.resolve('../views/analytics/progress.ejs'), 'utf8');
  assert.doesNotMatch(template, /Academic Period/);
  assert.match(template, /name="analysis_scope"/);
  assert.match(template, /Semester Completion Trends/);
  assert.match(template, /<th scope="col">Semester<\/th>/);
  assert.doesNotMatch(template, /name="academic_year"/);
});


test('Progress disclosures preserve separate completion categories, counts and semantic colors', async () => {
  const f = browser(); await f.idle();
  assert.equal(f.get('progress-clearanceRate').textContent, '0%');
  assert.equal(f.get('progress-withBacklog').textContent, '0');
  assert.equal(f.get('progress-unknown').textContent, '1');
  assert.match(f.get('progress-clearance-counts').textContent, /0 retake-cleared students \/ 1 eligible/);
  const chart = f.charts.get('progress-status-chart');
  assert.deepEqual(Array.from(chart.datasets[0].data), [2,0,1,1]);
  assert.deepEqual(Array.from(chart.datasets[0].colors), ['green','teal','red','purple']);
  assert.deepEqual(Array.from(f.charts.get('progress-trend-chart').datasets, d => d.color), ['green','teal','red','purple']);
  assert.match(f.get('progress-status-description').textContent, /Not determined: 1/);
  const template = fs.readFileSync(require.resolve('../views/analytics/progress.ejs'), 'utf8');
  assert.match(template, /<summary>Calculation details<\/summary>/);
  assert.match(template, /<summary>Chart data<\/summary>/);
  assert.match(template, /aria-describedby="progress-<%= key %>-description"/);
  assert.doesNotMatch(template, /Unknown|Insufficient Evidence/);
});

test('missing clearance rate stays unavailable and does not become zero', async () => {
  const f = browser(undefined, { clearanceRate: null, backlogStudents: 0, backlogCleared: 0 }); await f.idle();
  assert.equal(f.get('progress-clearanceRate').textContent, '-');
  assert.equal(f.get('progress-uncleared').textContent, '1');
  assert.equal(f.get('progress-unknown').textContent, '1');
});
