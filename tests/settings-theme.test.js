'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function browser(initial, dark = false) {
  const storage = new Map(initial ? [['sraas-theme', initial]] : []), cookies = new Map(), handlers = {};
  const root = { attributes: {}, classList: { add() {}, remove() {} }, setAttribute(key, value) { this.attributes[key] = value; }, getAttribute(key) { return this.attributes[key]; } };
  const mq = { matches: dark, addEventListener(name, callback) { handlers.os = callback; } };
  const radios = ['system', 'light', 'dark'].map(value => ({ value, checked: false, addEventListener() {} }));
  const toggle = { icon: {}, querySelector() { return this.icon; }, setAttribute() {} };
  const document = { documentElement: root, body: { classList: { add() {}, remove() {} } }, querySelector: () => toggle, querySelectorAll: query => query.includes('theme_preference') ? radios : [],
    get cookie() { return [...cookies].map(([k, v]) => k + '=' + v).join('; '); }, set cookie(value) { const [k, v] = value.split(';')[0].split('='); cookies.set(k, v); } };
  const window = { matchMedia: () => mq, addEventListener(name, callback) { handlers[name] = callback; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/themeSwitcher.js'), 'utf8'), { document, window, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, setTimeout });
  return { root, mq, radios, toggle, storage, cookies, window, handlers };
}
test('System remains a stored preference and follows subsequent OS changes', () => {
  const b = browser(undefined, true); assert.equal(b.root.attributes['data-theme'], 'dark'); assert.equal(b.storage.get('sraas-theme'), 'system');
  b.mq.matches = false; b.handlers.os({ matches: false }); assert.equal(b.root.attributes['data-theme'], 'light'); assert.equal(b.storage.get('sraas-theme'), 'system'); assert.equal(b.cookies.get('themePreference'), 'system');
});
test('Light and Dark preferences, Settings radio selection and navbar toggle synchronize', () => {
  const b = browser('light', true); assert.equal(b.root.attributes['data-theme'], 'light');
  b.window.setThemePreference('dark'); assert.equal(b.radios.find(r => r.value === 'dark').checked, true); assert.equal(b.cookies.get('theme'), 'dark');
  b.window.toggleTheme(); assert.equal(b.window.getThemePreference(), 'light'); assert.equal(b.toggle.icon.textContent, 'dark_mode');
  b.window.setThemePreference('system'); assert.equal(b.window.getThemePreference(), 'system'); assert.equal(b.root.attributes['data-theme'], 'dark');
  b.mq.matches = false; b.handlers.os({ matches: false }); assert.equal(b.root.attributes['data-theme'], 'light');
});
test('Explicit preference ignores OS changes and server rejects invalid theme cookies', () => {
  const b = browser('dark', false); b.mq.matches = true; b.handlers.os({ matches: true }); assert.equal(b.window.getThemePreference(), 'dark');
  const res = { locals: {} }; require('../middlewares/themeMiddleware')({ cookies: { theme: 'invalid', themePreference: 'invalid' } }, res, () => {});
  assert.deepEqual(res.locals, { theme: 'light', themePreference: 'system', themeClass: 'theme-light' });
});
