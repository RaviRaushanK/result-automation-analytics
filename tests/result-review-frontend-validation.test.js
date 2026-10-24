'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(type = 'REGULAR') {
  const elements = {}, fields = [], messages = [];
  function field(id, value, options = {}) {
    const classes = new Set(), handlers = {}, attrs = {};
    const input = { id, name: id, value, type: 'text', dataset: {}, max: '50', ...options,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      setAttribute: (key, value) => { attrs[key] = value; }, removeAttribute: key => { delete attrs[key]; }, getAttribute: key => attrs[key],
      addEventListener(event, handler) { (handlers[event] ||= []).push(handler); },
      dispatch(event) { (handlers[event] || []).forEach(handler => handler.call(input)); }, focus() { input.focused = true; }
    };
    const parent = { querySelector: () => messages.find(message => message.parentNode === parent) || null,
      appendChild(message) { messages.push(message); message.parentNode = parent; },
      removeChild(message) { messages.splice(messages.indexOf(message), 1); } };
    input.parentNode = parent; elements[id] = input; fields.push(input); return input;
  }
  field('usnInput', 'TEST001'); field('studentNameInput', 'TEST STUDENT');
  const attempt = field('reviewAttemptNo', type === 'REGULAR' ? '1' : '2', { type: 'number' });
  const verification = field('verify_period', '1', { type: 'checkbox', checked: true });
  const scope = field('verify_mixed_context', '1', { type: 'checkbox', checked: true });
  const row = id => {
    const internal = field('internal_' + id, '30', { type: 'number' });
    const external = field('external_' + id, '20', { type: 'number' });
    const total = { classList: { add() {}, remove() {} } }, status = {};
    elements['total_' + id + '_feedback'] = { hidden: true, textContent: '', classList: { add() {}, remove() {} } };
    return { dataset: { subjectId: String(id), maxMarks: '100', maxInternal: '50', maxExternal: '50', subjectType: 'theory' }, internal, external, status,
      querySelector: selector => ({ '.internal-input': internal, '.external-input': external, '.total-cell': total, '.total-value': total, '.status-cell': status })[selector] };
  };
  const rows = [row(1), row(2)];
  let submit;
  const checks = [verification, scope];
  const form = { dataset: { registrationBlocked: 'false' }, querySelector: () => ({ value: type }),
    querySelectorAll: selector => selector.includes('checkbox') ? checks : [],
    addEventListener(event, handler) { if (event === 'submit') submit = handler; } };
  elements.reviewForm = form;
  const document = {
    getElementById: id => elements[id] || null,
    addEventListener(event, handler) { handler(); },
    createElement: () => ({ dataset: {} }),
    querySelectorAll(selector) {
      if (selector.includes('tr[data-max-marks]')) return rows;
      if (selector.includes('.field-error-message')) return messages.slice();
      if (selector.includes('.is-invalid')) return fields.filter(input => input.classList.contains('is-invalid'));
      return [];
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/results/review.js'), 'utf8'), { document, McaPassRules: require('../public/js/mca-pass-rules') });
  return { rows, attempt, verification, scope, messages, elements,
    submit() { let blocked = false; submit({ preventDefault() { blocked = true; } }); return blocked; } };
}

test('Result Review shows Bootstrap feedback for missing identity/scope confirmations and clears it when checked', () => {
  const f = fixture(); f.verification.checked = false; f.scope.checked = false;
  assert.equal(f.submit(), true);
  assert.equal(f.verification.classList.contains('is-invalid'), true);
  assert.equal(f.verification.getAttribute('aria-invalid'), 'true');
  assert.ok(f.messages.every(message => message.className.includes('invalid-feedback')));
  f.verification.checked = true; f.verification.dispatch('change');
  f.scope.checked = true; f.scope.dispatch('change');
  assert.equal(f.verification.classList.contains('is-invalid'), false);
  assert.equal(f.submit(), false);
});

test('Result Review validates component marks, whole-number attempts and totals without erasing errors during editing', () => {
  for (const value of ['', '-1', '2.5', '20abc', '1e1', '51']) {
    const f = fixture(); f.rows[0].external.value = value;
    assert.equal(f.submit(), true, value);
    f.rows[0].external.dispatch('input');
    assert.equal(f.rows[0].external.classList.contains('is-invalid'), true);
    f.rows[0].external.value = '0'; f.rows[0].external.dispatch('input');
    assert.equal(f.submit(), false);
  }
  const f = fixture(); f.rows[0].dataset.maxMarks = '40';
  assert.equal(f.submit(), true);
  assert.match(f.elements.total_1_feedback.textContent, /Total marks must not exceed 40/);
  assert.equal(f.elements.total_1_feedback.hidden, false);
  assert.equal(f.rows[0].external.classList.contains('is-invalid'), false);
  assert.ok(f.messages.every(message => !/Total marks/.test(message.textContent)));
  f.rows[0].dataset.maxMarks = '100'; f.attempt.value = '2';
  assert.equal(f.submit(), true);
  f.attempt.value = '1'; f.attempt.dispatch('input');
  assert.equal(f.submit(), false);
  assert.equal(f.elements.total_1_feedback.hidden, true);
});

test('backlog leaves unattempted subjects blank but requires both marks for attempted rows and at least one attempted subject', () => {
  const f = fixture('BACKLOG'); f.rows[1].internal.value = ''; f.rows[1].external.value = '';
  assert.equal(f.submit(), false);
  f.rows[0].external.value = '';
  assert.equal(f.submit(), true);
  f.rows[0].internal.value = '';
  assert.equal(f.submit(), true);
  f.rows[0].internal.value = '0'; f.rows[0].external.value = '0';
  assert.equal(f.submit(), false);
  f.attempt.value = '1';
  assert.equal(f.submit(), true);
  f.attempt.value = '100';
  assert.equal(f.submit(), false);
});

test('Review live status preserves printed FAIL above 50 while ordinary passing rows remain PASS', () => {
  const f = fixture();
  f.rows[0].dataset.documentStatus = 'fail';
  f.rows[0].internal.value = '37'; f.rows[0].external.value = '14';
  f.rows[0].external.dispatch('input');
  assert.match(f.rows[0].status.innerHTML, />FAIL</);
  assert.doesNotMatch(f.rows[0].status.innerHTML, />PASS</);
  f.rows[1].internal.value = '32'; f.rows[1].external.value = '20';
  f.rows[1].external.dispatch('input');
  assert.match(f.rows[1].status.innerHTML, />PASS</);
});
