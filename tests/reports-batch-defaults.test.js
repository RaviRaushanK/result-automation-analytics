'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const types = ['student', 'class', 'subject', 'revaluation', 'toppers', 'consolidated', 'result-analysis', 'student-progress'];
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function fixture(type, search = '', batches = [{ batch_id: 9, batch_name: 'Newest', start_year: 2026, end_year: 2028 }, { batch_id: 2, batch_name: 'Older', start_year: 2025, end_year: 2027 }]) {
  const elements = new Map(), requests = [];
  class Option {
    constructor(text, value) { this.textContent = text; this.value = value; }
  }
  function el(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: true, hidden: false, options: [], handlers: {}, textContent: '',
      dataset: { reportType: type }, labels: [{ textContent: id.replace('report-', '') }],
      addEventListener(event, handler) { this.handlers[event] = handler; },
      replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; },
      add(option) { this.options.push(option); }, closest() { return this; }
    });
    return elements.get(id);
  }
  el('report-mode').options = [new Option('Effective', 'effective'), new Option('Original', 'original')];
  el('report-mode').value = 'effective';
  const browser = {
    document: { getElementById: el }, window: { dispatchEvent() {} },
    location: { search }, Option, URLSearchParams, AbortController, Event, setTimeout, clearTimeout,
    fetch: async url => {
      requests.push(url);
      const options = url === '/reports/api/batches' ? batches
        : url.includes('/students?') ? [{ student_id: 31, usn: 'TEST', student_name: 'Student' }]
        : url.includes('student-semesters') || url.endsWith('/semesters') ? [{ semester: '1' }] : [];
      return { ok: true, json: async () => ({ success: true, options }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/reports/common.js'), 'utf8'), browser);
  return { el, requests };
}

for (const type of types) {
  test(`${type}: defaults to newest batch and loads dependent options`, async () => {
    const f = fixture(type);
    await settle();
    assert.equal(f.el('report-batch_id').value, '9');
    if (type === 'student-progress') assert.equal(f.el('reports-generate').disabled, false);
    else assert.ok(f.requests.some(url => url.includes('/batches/9/')));
  });

  test(`${type}: retains linked older batch and Reset restores newest batch`, async () => {
    const f = fixture(type, '?batch_id=2');
    await settle();
    assert.equal(f.el('report-batch_id').value, '2');
    f.el('reports-filters').handlers.reset({ preventDefault() {} });
    await settle();
    assert.equal(f.el('report-batch_id').value, '9');
    if (type !== 'student-progress') assert.ok(f.requests.some(url => url.includes('/batches/9/')));
  });
}

test('empty batch list leaves report generation disabled without dependent requests', async () => {
  const f = fixture('class', '', []);
  await settle();
  assert.equal(f.el('report-batch_id').value, '');
  assert.equal(f.el('report-batch_id').disabled, true);
  assert.equal(f.el('reports-generate').disabled, true);
  assert.deepEqual(f.requests, ['/reports/api/batches']);
});

test('Student Result links preserve both student and batch selections', async () => {
  const f = fixture('student', '?batch_id=2&student_id=31');
  await settle();
  assert.equal(f.el('report-batch_id').value, '2');
  assert.equal(f.el('report-student_id').value, '31');
  assert.ok(f.requests.some(url => url.includes('student-semesters?batch_id=2&student_id=31')));
});
