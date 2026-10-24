'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function classList(initial = []) {
  const values = new Set(initial);
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value),
    toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); } };
}
function fixture() {
  const elements = {}, fields = [], details = { open: false };
  let choice = 'accept';
  const row = { dataset: { maxMarks: '100' }, querySelector: () => choice === 'accept' ? accept : reject };
  function field(id, value, type, classes = []) {
    const handlers = {};
    const item = { id, value, type, tagName: type === 'select' ? 'SELECT' : 'INPUT', checked: false, required: false,
      disabled: false, max: '50', classList: classList(classes), error: '', attrs: {},
      setCustomValidity(error) { this.error = error; },
      get validity() { return { valid: this.disabled || (!this.error && (!this.required || (this.type === 'checkbox' ? this.checked : this.value !== ''))) }; },
      setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
      getAttribute(key) { return key === 'data-srid' ? '1' : this.attrs[key]; },
      closest: selector => selector === 'tr' ? row : id === 'pick_1' && selector === 'details' ? details : null,
      focus() { this.focused = true; },
      addEventListener(event, handler) { (handlers[event] ||= []).push(handler); },
      dispatch(event) { (handlers[event] || []).forEach(handler => handler()); }
    };
    elements[id] = item; elements[id + '_feedback'] = { textContent: '' }; fields.push(item);
    return item;
  }
  const internal = field('int_1', '30', 'number', ['rev-int']);
  const external = field('ext_1', '20', 'number', ['rev-ext']);
  const verification = field('verify_old_status', '1', 'checkbox'); verification.required = true; verification.checked = true;
  const pick = field('pick_1', '1', 'select');
  const ack = field('ack_1', 'on', 'checkbox'); ack.checked = true;
  const accept = field('accept_1', 'accept', 'radio'), reject = field('reject_1', 'reject', 'radio');
  accept.checked = true;
  elements.tot_1 = { textContent: '' };
  elements.oldExternalResultVerificationStatus = { textContent: '', classList: classList() };
  let submitHandler;
  const form = { classList: classList(),
    querySelector(selector) {
      if (selector === 'input[name="verify_old_status"]') return verification;
      if (selector === ':invalid') return fields.find(field => !field.validity.valid);
      return choice === 'accept' ? accept : reject;
    },
    querySelectorAll: selector => selector === '.rev-int, .rev-ext' ? [internal, external] : fields,
    checkValidity: () => fields.every(field => field.validity.valid),
    addEventListener(event, handler) { if (event === 'submit') submitHandler = handler; }
  };
  const document = {
    getElementById: id => id === 'reviewForm' ? form : elements[id] || null,
    querySelectorAll: selector => selector === 'input.rev-decision' ? [accept, reject] : selector === '#reviewTable tbody tr' ? [row] : []
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/revaluation-review.js'), 'utf8'), { document });
  return { internal, external, verification, pick, ack, row, form, details, elements,
    choose(value) { choice = value; accept.checked = value === 'accept'; reject.checked = !accept.checked; (accept.checked ? accept : reject).dispatch('change'); },
    submit() { let blocked = false; submitHandler({ preventDefault() { blocked = true; }, stopPropagation() {} }); return blocked; }
  };
}

test('Bootstrap blocks missing acknowledgments and focuses the invalid field; checking clears feedback', () => {
  const f = fixture(); f.verification.checked = false;
  assert.equal(f.submit(), true);
  assert.equal(f.form.classList.contains('was-validated'), true);
  assert.equal(f.verification.attrs['aria-invalid'], 'true');
  assert.equal(f.verification.focused, true);
  f.verification.checked = true; f.verification.dispatch('change');
  assert.equal(f.verification.classList.contains('is-invalid'), false);
  assert.equal(f.elements.oldExternalResultVerificationStatus.textContent, 'Manually confirmed');
  assert.equal(f.submit(), false);
});

test('accepted rows reject blank, negative, decimal, malformed and excessive component marks', () => {
  for (const value of ['', '-1', '2.5', '20abc', '1e1', '51']) {
    const f = fixture(); f.external.value = value;
    assert.equal(f.submit(), true, value);
    assert.equal(f.external.classList.contains('is-invalid'), true);
    assert.match(f.elements.ext_1_feedback.textContent, /whole number from 0 to 50/);
    f.external.value = '0'; f.external.dispatch('input');
    assert.equal(f.external.classList.contains('is-invalid'), false);
    assert.equal(f.submit(), false);
  }
});

test('total ceilings receive field feedback and corrections clear stale custom errors', () => {
  const f = fixture(); f.row.dataset.maxMarks = '60'; f.internal.value = '40'; f.external.value = '40';
  assert.equal(f.submit(), true);
  assert.match(f.elements.ext_1_feedback.textContent, /must not exceed 60/);
  f.internal.value = '20'; f.internal.dispatch('input');
  assert.equal(f.external.error, '');
  assert.equal(f.submit(), false);
});

test('ambiguous picks and exceptional-status acknowledgments are required only for accepted rows', () => {
  const f = fixture(); f.pick.value = ''; f.ack.checked = false;
  assert.equal(f.submit(), true);
  assert.equal(f.details.open, true);
  f.choose('reject');
  assert.equal(f.internal.disabled, true); assert.equal(f.external.disabled, true);
  assert.equal(f.pick.required, false); assert.equal(f.ack.required, false);
  assert.equal(f.submit(), false);
  f.choose('accept');
  assert.equal(f.internal.required, true); assert.equal(f.pick.required, true); assert.equal(f.ack.required, true);
  assert.equal(f.submit(), true);
  f.pick.value = '1'; f.pick.dispatch('change'); f.ack.checked = true; f.ack.dispatch('change');
  assert.equal(f.submit(), false);
});

test('review template supplies Bootstrap feedback and native range constraints without changing approval form', () => {
  const source = fs.readFileSync(path.join(__dirname, '../views/revaluation/review.ejs'), 'utf8');
  assert.match(source, /id="reviewForm"[\s\S]*?needs-validation[\s\S]*?novalidate/);
  assert.match(source, /name="verify_<%= check.key %>"[^>]*value="1" required/);
  assert.match(source, /id="int_<%= r.srid %>_feedback"/);
  assert.match(source, /id="ext_<%= r.srid %>_feedback"/);
  assert.match(source, /min="0" max="<%= r.maxExternal %>" step="1"/);
  assert.match(source, /id="approveRevaluationForm">/);
  assert.match(source, /Combined total/);
  assert.match(source, /RV\/Final marks are external marks/);
  assert.match(source, /Internal is carried IA, not automatically revised IA/);
  assert.doesNotMatch(source, /verify_revised_internal_|verify_revised_external_/);
});
