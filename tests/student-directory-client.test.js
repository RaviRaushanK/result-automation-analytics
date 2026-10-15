'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(batches = []) {
  const elements = new Map(), events = {}, requests = [], timers = new Map();
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, attributes: {}, handlers: {},
      classList: { add() {}, remove() {} }, setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(event, handler) { const previous = this.handlers[event]; this.handlers[event] = previous ? (...args) => { previous(...args); return handler(...args); } : handler; }, focus() {}, appendChild() {} });
    return elements.get(id);
  }
  element('studentListing').dataset = { defaultBatch: '2', pagination: JSON.stringify({ page: 2, pageSize: 25, totalRows: 60, totalPages: 3 }) };
  element('studentPageSize').value = '25'; element('filterBatch').value = 'all';
  element('studentSearchError').hidden = true;
  element('batchesData').dataset.batches = JSON.stringify(batches);
  element('#studentsTable tbody').innerHTML = '<tr><td>Previous students</td></tr>';
  const location = { pathname: '/students', search: '?batch_id=all&page=2&pageSize=25' };
  const history = { entries: [], pushState(data, title, url) { this.entries.push(url); this.replaceState(data, title, url); }, replaceState(data, title, url) { const parsed = new URL(url, 'http://localhost'); location.pathname = parsed.pathname; location.search = parsed.search; } };
  const browser = { console, URLSearchParams, AbortController, location, history,
    window: { addEventListener(name, handler) { events[name] = handler; } },
    document: { getElementById: element, querySelector: element,
      createElement: () => ({ textContent: '', setAttribute() {}, set innerHTML(value) { this.textContent = value; }, get innerHTML() { return String(this.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); } }),
      addEventListener(name, handler) { if (name === 'DOMContentLoaded') handler(); } },
    bootstrap: { Modal: function () { this.show = () => {}; this.hide = () => {}; } },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, options = {}) {
      if (url.includes('/stats')) return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      return new Promise((resolve, reject) => requests.push({ url, signal: options.signal, reject,
        respond(body, ok = true) { resolve({ ok, status: ok ? 200 : 500, json: async () => body }); } }));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/students.js'), 'utf8'), browser);
  const flush = async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await pause(0); };
  const respond = async (request, student, total = 1, page = 1) => {
    request.respond({ success: true, data: student ? [{ student_id: 42, batch_id: 2, usn: 'USN042', email: 'student@gmail.com', student_name: student, category: 'PGCET', status: 'active' }] : [],
      pagination: { page, pageSize: 25, totalRows: total, totalPages: Math.ceil(total / 25) } }); await pause(0);
  };
  return { element, events, requests, history, location, flush, respond };
}

test('typing invalidates pending work immediately; abort and sequence guard reject late responses', async () => {
  const f = fixture();
  f.element('studentSearch').value = 'old'; f.element('studentSearch').handlers.input(); await f.flush();
  const old = f.requests[0];
  f.element('studentSearch').value = 'new'; f.element('studentSearch').handlers.input();
  assert.equal(old.signal.aborted, true);
  await f.respond(old, 'Stale student');
  assert.doesNotMatch(f.element('#studentsTable tbody').innerHTML, /Stale/);
  assert.equal(f.element('studentSearchLoading').hidden, false);
  await f.flush(); await f.respond(f.requests[1], 'Current student');
  assert.match(f.element('#studentsTable tbody').innerHTML, /Current student/);
  assert.equal(f.element('studentSearchLoading').hidden, true);
  assert.equal(f.element('studentSearchError').hidden, true);
  assert.equal(new URLSearchParams(f.location.search).get('search'), 'new');
  assert.equal(new URLSearchParams(f.requests[1].url.split('?')[1]).get('page'), '1');
});

test('genuine failures retain rows; intentionally aborted searches never show an error', async () => {
  const f = fixture();
  f.element('filterStatus').value = 'active'; f.element('filterStatus').handlers.change();
  f.requests[0].respond({ success: false, message: 'Unable to search students. Please try again.' }, false); await pause(0);
  assert.match(f.element('#studentsTable tbody').innerHTML, /Previous students/);
  assert.match(f.element('studentSearchError').textContent, /Previous results have been kept/);
  f.element('filterCategory').handlers.change();
  f.element('filterBatch').handlers.change();
  assert.equal(f.requests[1].signal.aborted, true);
  f.requests[1].reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); await pause(0);
  assert.equal(f.element('studentSearchError').hidden, true);
  await f.respond(f.requests[2], 'Final student');
  assert.match(f.element('#studentsTable tbody').innerHTML, /Final student/);
});

test('pagination preserves filters and updates counts, filter changes reset page, history restores state', async () => {
  const f = fixture();
  f.element('studentSearch').value = 'student'; f.element('filterCategory').value = 'PGCET'; f.element('filterStatus').value = 'active';
  f.element('studentNextPage').handlers.click();
  const params = new URLSearchParams(f.requests[0].url.split('?')[1]);
  assert.equal(params.get('page'), '3'); assert.equal(params.get('batch_id'), 'all');
  assert.equal(params.get('search'), 'student'); assert.equal(params.get('status'), 'active'); assert.equal(params.get('category'), 'PGCET');
  await f.respond(f.requests[0], 'Student on page three', 60, 3);
  assert.equal(f.element('studentResultCount').textContent, 'Showing 51-60 of 60 students');
  assert.equal(f.element('studentNextPage').disabled, true);
  assert.match(f.element('#studentsTable tbody').innerHTML, /<td>51<\/td>/);
  assert.match(f.element('#studentsTable tbody').innerHTML, /\/reports\/student\?batch_id=2&amp;student_id=42/);
  f.element('filterStatus').value = 'inactive'; f.element('filterStatus').handlers.change();
  assert.equal(new URLSearchParams(f.requests[1].url.split('?')[1]).get('page'), '1');
  await f.respond(f.requests[1], null, 0);
  assert.equal(f.element('studentResultCount').textContent, '0 students found');
  assert.match(f.element('#studentsTable tbody').innerHTML, /No students matched/);
  f.location.search = '?search=ravi&batch_id=1&status=active&category=MGT&page=2&pageSize=50'; f.events.popstate();
  assert.equal(f.element('filterBatch').value, '1'); assert.equal(f.element('studentSearch').value, 'ravi'); assert.equal(f.element('studentPageSize').value, '50');
  assert.equal(new URLSearchParams(f.requests[2].url.split('?')[1]).get('page'), '2');
});

test('clear search cancels queued debounce and safely escapes no-match text', async () => {
  const f = fixture();
  f.element('studentSearch').value = '<img src=x onerror=alert(1)>'; f.element('studentSearch').handlers.input(); await f.flush();
  await f.respond(f.requests[0], null, 0);
  assert.match(f.element('#studentsTable tbody').innerHTML, /&lt;img/);
  assert.doesNotMatch(f.element('#studentsTable tbody').innerHTML, /<img/);
  f.element('studentSearch').value = 'queued'; f.element('studentSearch').handlers.input();
  f.element('clearStudentSearch').handlers.click(); await f.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(new URLSearchParams(f.requests[1].url.split('?')[1]).has('search'), false);
  assert.equal(f.element('clearStudentSearch').hidden, true);
});

test('opening Student Import defaults to newest batch and active, independently of directory filters', () => {
  const f = fixture([{ id: 9, name: 'Newest' }, { id: 2, name: 'Older' }]);
  f.element('filterBatch').value = '2';
  f.element('importStudentsBtn').handlers.click();
  assert.equal(f.element('importBatch').value, '9');
  assert.equal(f.element('importStatus').value, 'active');
  f.element('importBatch').value = '2'; f.element('importStatus').value = 'inactive';
  f.element('importStudentsBtn').handlers.click();
  assert.equal(f.element('importBatch').value, '9');
  assert.equal(f.element('importStatus').value, 'active');
  const empty = fixture();
  empty.element('importStudentsBtn').handlers.click();
  assert.equal(empty.element('importBatch').value, '');
});

test('successful import refreshes categories and suggestions without navigation or losing the filter', async () => {
  const f = fixture([{ id: 9, name: 'Newest' }]);
  f.element('filterCategory').value = 'PGCET';
  f.element('importStudentsBtn').handlers.click();
  f.element('importConfirmBtn').handlers.click();
  const confirm = f.element('studentConfirmBtn').handlers.click();
  const request = f.requests.find(r => r.url === '/students/api/import/confirm');
  request.respond({ success: true, message: 'Imported', data: { imported: 1, skipped: 0 } });
  await confirm;
  const categories = f.requests.find(r => r.url === '/students/api/categories');
  assert.ok(categories);
  categories.respond({ success: true, data: ['MGT', 'PGCET', 'NEW "<CATEGORY>'] });
  await pause(0);
  assert.match(f.element('filterCategory').innerHTML, /MGT/);
  assert.match(f.element('filterCategory').innerHTML, /NEW &quot;&lt;CATEGORY>/);
  assert.equal(f.element('filterCategory').value, 'PGCET');
  assert.match(f.element('studentCategoryList').innerHTML, /MGT/);
  assert.ok(f.requests.find(r => r.url.startsWith('/students/api/list?')));
  assert.equal(f.history.entries.length, 0);
});

test('failed import keeps existing categories and does not reload them', async () => {
  const f = fixture();
  f.element('filterCategory').innerHTML = '<option>Existing</option>';
  f.element('importConfirmBtn').handlers.click();
  const confirm = f.element('studentConfirmBtn').handlers.click();
  f.requests[0].respond({ message: 'Import failed' }, false);
  await confirm;
  assert.equal(f.element('filterCategory').innerHTML, '<option>Existing</option>');
  assert.equal(f.requests.length, 1);
});
