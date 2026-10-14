'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

function fixture() {
  const document = { activeElement: null, handlers: {}, addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); } };
  function node() {
    return { value: '', hidden: false, disabled: false, dataset: {}, attributes: {}, handlers: {}, children: [],
      addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); },
      dispatchEvent(event) { (this.handlers[event.type] || []).forEach(fn => fn(event)); },
      setAttribute(key, value) { this.attributes[key] = value; }, focus() { document.activeElement = this; },
      replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
      closest() { return this.dataset.pickYear ? this : null; },
      querySelector(selector) { const year = selector.match(/data-pick-year="(\d+)"/); return year ? this.children.find(child => child.dataset.pickYear === year[1]) : null; }
    };
  }
  document.createElement = node;
  const form = node(), modal = node();
  const roots = [0, 1].map(() => {
    const root = node();
    const elements = Object.fromEntries(['input', '[data-year-toggle]', '.batch-year-panel', '[data-year-grid]', '[data-year-prev]', '[data-year-next]', '[data-year-range]'].map(key => [key, node()]));
    elements.input.min = '1900'; elements.input.max = '2200'; elements.input.form = form;
    elements['.batch-year-panel'].hidden = true;
    root.querySelector = key => elements[key]; root.closest = () => modal;
    root.contains = element => element === root || Object.values(elements).includes(element) || elements['[data-year-grid]'].children.includes(element);
    return { root, elements };
  });
  document.querySelectorAll = () => roots.map(item => item.root);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/year-picker.js'), 'utf8'), { document, Event, Date, setTimeout });
  const click = target => target.dispatchEvent(new Event('click'));
  const key = (root, target, value, altKey = false) => { const event = { type: 'keydown', target, key: value, altKey, preventDefault() {}, stopPropagation() {} }; root.dispatchEvent(event); };
  const pick = (index, year) => { const elements = roots[index].elements, button = elements['[data-year-grid]'].children.find(child => child.dataset.pickYear === String(year)); elements['[data-year-grid]'].handlers.click[0]({ target: button }); };
  return { roots, form, modal, document, click, key, pick };
}

test('calendar picker keeps original numeric fields and accessible manual-entry validation', async () => {
  for (const [controlId, fieldName] of [['createBatchStartYear', 'start_year'], ['createBatchEndYear', 'end_year']]) {
    const html = await ejs.renderFile(path.join(__dirname, '../views/batches/partials/year-input.ejs'), { controlId, fieldName, fieldLabel: 'Year', placeholder: '2026', feedback: 'Invalid year' });
    assert.match(html, new RegExp('id="' + controlId + '" name="' + fieldName + '"'));
    assert.match(html, /type="number"/); assert.match(html, /min="1900" max="2200" step="1"/);
    assert.match(html, /aria-expanded="false"/); assert.match(html, /calendar_month/);
    assert.match(html, /class="invalid-feedback"/);
  }
});

test('year selection dispatches existing validation events, permits typing, and opens at the entered year', () => {
  const f = fixture(), { elements } = f.roots[0];
  elements.input.value = '2025';
  const events = [];
  elements.input.addEventListener('input', () => events.push('input'));
  elements.input.addEventListener('change', () => events.push('change'));
  f.click(elements['[data-year-toggle]']);
  assert.equal(elements['[data-year-range]'].textContent, '2020-2029');
  assert.equal(f.document.activeElement.dataset.pickYear, '2025');
  f.pick(0, 2027);
  assert.equal(elements.input.value, '2027'); assert.deepEqual(events, ['input', 'change']);
  assert.equal(elements['.batch-year-panel'].hidden, true);
  assert.equal(f.document.activeElement, elements.input);
  elements.input.value = '2031'; f.click(elements['[data-year-toggle]']);
  assert.equal(f.document.activeElement.dataset.pickYear, '2031');
});

test('decade navigation, year bounds, keyboard selection, Escape and modal/reset cleanup work', () => {
  const f = fixture(), { root, elements } = f.roots[0];
  elements.input.value = '1900'; f.click(elements['[data-year-toggle]']);
  assert.equal(elements['[data-year-prev]'].disabled, true);
  f.click(elements['[data-year-next]']); assert.equal(elements['[data-year-range]'].textContent, '1910-1919');
  f.key(root, elements['[data-year-grid]'].children[0], 'ArrowRight');
  assert.equal(f.document.activeElement.dataset.pickYear, '1911');
  f.key(root, f.document.activeElement, 'PageDown'); assert.equal(f.document.activeElement.dataset.pickYear, '1921');
  f.key(root, f.document.activeElement, 'Escape'); assert.equal(elements['.batch-year-panel'].hidden, true);
  elements.input.value = '2200'; f.key(root, elements.input, 'ArrowDown', true);
  assert.equal(elements['[data-year-next]'].disabled, true);
  assert.equal(elements['[data-year-grid]'].children.filter(button => !button.disabled).length, 1);
  f.click(f.roots[1].elements['[data-year-toggle]']); assert.equal(elements['.batch-year-panel'].hidden, true);
  f.form.dispatchEvent(new Event('reset')); assert.equal(f.roots[1].elements['.batch-year-panel'].hidden, true);
  f.click(elements['[data-year-toggle]']); f.modal.dispatchEvent(new Event('hidden.bs.modal')); assert.equal(elements['.batch-year-panel'].hidden, true);
});
