'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function render(rows) {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.options = [1, 2]; this.handlers = {}; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(' '); }
    set innerHTML(value) { assert.equal(value, ''); this.children = []; this.text = ''; }
    appendChild(child) { this.children.push(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, handler) { this.handlers[event] = handler; }
    replaceChildren(...children) { this.children = children; this.text = ''; }
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id); };
  let page;
  const context = { URLSearchParams, window: { AnalyticsPage(config) { page = config; } },
    document: { getElementById: get, createElement: tag => new Element(tag) },
    fetch: async url => ({ json: async () => url.includes('/detail?') ? { detail: rows } : { bySubject: [] } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/analytics/revaluation'), 'utf8'), context);
  page.done({}, { params: new URLSearchParams(), number: String });
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  const body = get('revaluation-detail-body');
  body.lookup = get;
  return body;
}

const example = { subjectName: 'Example subject', subjectCode: 'TEST101', studentName: 'Example Student', usn: 'TEST001', caseId: 91,
  originalMarks: 45, revisedMarks: 50, delta: 5, originalStatus: 'fail', revisedStatus: 'pass', validationStatus: 'approved',
  remarkSummary: JSON.stringify({ import_id: 123, event_fingerprint: 'PRIVATE_FINGERPRINT', decision: 'accept', event_ids: [91] }),
  sourceFile: 'C:\\private\\uploads\\source.pdf' };

test('effective detail opens readable audit references in a popup without changing IDs', async () => {
  const body = await render([example]);
  const cells = body.children[0].children;
  assert.equal(cells.length, 7);
  assert.equal(cells[0].textContent, 'Example subject TEST101');
  assert.equal(cells[1].textContent, 'Example Student TEST001');
  assert.deepEqual(cells.slice(2, 6).map(cell => cell.textContent), ['45','50','+5','Fail → Pass']);
  const button = cells[6].children[0].children[0];
  assert.equal(button.tagName, 'button');
  assert.equal(button.attributes['data-bs-toggle'], 'modal');
  assert.equal(button.attributes['data-bs-target'], '#revaluation-audit-modal');
  assert.match(button.attributes['aria-label'], /Example Student, Example subject/);
  button.handlers.click();
  const details = body.lookup('revaluation-audit-content');
  assert.match(details.textContent, /Revaluation record ID 91/);
  assert.match(details.textContent, /Import record ID 123/);
  assert.match(details.textContent, /Approval status Approved/);
  assert.match(details.textContent, /Review decision Accepted/);
  assert.match(details.textContent, /Source document source.pdf/);
  assert.doesNotMatch(body.textContent, /PRIVATE_FINGERPRINT|event_ids|import_id|private|uploads/);
  assert.equal(cells[4].attributes['data-sort-value'], '+5');
});

test('zero, missing values and negative changes keep their original meanings', async () => {
  const body = await render([{ ...example, originalMarks: 0, revisedMarks: null, delta: -2, originalStatus: '', revisedStatus: '' }]);
  assert.deepEqual(body.children[0].children.slice(2,6).map(cell => cell.textContent), ['0','—','-2','— → —']);
});

test('plain remarks remain readable text and malformed audit metadata is not dumped into the table', async () => {
  const note = '<img src=x onerror=alert(1)> Administrator note';
  const body = await render([{ ...example, remarkSummary: note }, { ...example, remarkSummary: '{broken json' }]);
  assert.match(body.children[0].textContent, /Administrator note/);
  body.children[0].children[6].children[0].children[0].handlers.click();
  assert.equal(body.lookup('revaluation-audit-content').children[0].children.find(node => node.textContent === note).tagName, 'dd');
  body.children[1].children[6].children[0].children[0].handlers.click();
  assert.match(body.lookup('revaluation-audit-content').textContent, /Unavailable for this record/);
  assert.doesNotMatch(body.lookup('revaluation-audit-content').textContent, /Administrator note/);
  assert.doesNotMatch(body.children[1].textContent, /broken json/);
});

test('empty states and template headings match the seven-column detail table', async () => {
  const body = await render([]);
  assert.equal(body.children[0].children[0].colSpan, 7);
  const template = fs.readFileSync(require.resolve('../views/analytics/revaluation.ejs'), 'utf8');
  assert.match(template, /Applied Revaluation Changes/);
  assert.match(template, /Original total/);
  assert.match(template, /Effective total/);
  assert.doesNotMatch(template, />Remark Type<|>Validation<|>Case ID</);
  const css = fs.readFileSync(require.resolve('../public/css/analytics.css'), 'utf8');
  assert.match(css, /revaluation-detail-table td.*word-break: normal/);
  assert.match(css, /revaluation-audit-modal dd.*var\(--text-primary\)/);
  assert.match(template, /aria-labelledby="revaluation-audit-title"/);
  assert.match(template, /These IDs identify saved records; they are not marks/);
  assert.equal((template.match(/data-bs-dismiss="modal"/g) || []).length, 2);
});
