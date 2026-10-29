'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const template = path.join(__dirname, '../views/results/success.ejs');
const values = { formatGpa: require('../public/js/gpa-format').format, savedConfirmed: true, studentName: 'Test Student', usn: '1MV25MC061', sessionDisplay: 'MCA 2025 - June 2026', batchId: 1, examSessionId: 1, attemptNo: 1, examType: 'REGULAR', subjectsCount: 6, overallResult: 'pass', sgpa: 8, cgpa: 8.25 };
test('success page shows saved metrics, import details and existing next actions', async () => {
  const html = await ejs.renderFile(template, values);
  for (const text of ['Result imported successfully', '1MV25MC061', '8.00', '8.25', 'PASS', 'is-confirmed', '/results/upload', '/results/logs']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /card-body|border-success/);
  assert.equal((html.match(/--piece:/g) || []).length, 96);
  assert.equal((html.match(/--origin:7%/g) || []).length, 48);
  assert.equal((html.match(/--origin:93%/g) || []).length, 48);
  assert.match(html, /replayImportCelebration/);
});
test('missing GPA stays unavailable and zero remains a valid saved metric', async () => {
  const html = await ejs.renderFile(template, { ...values, sgpa: 0, cgpa: null });
  assert.match(html, /0\.00/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Complete verified course and grading history/);
  assert.doesNotMatch(html, /NaN/);
});

test('backlog without SGPA explains the retake policy without hiding valid GPA', async () => {
  const html = await ejs.renderFile(template, { ...values, examType: 'BACKLOG', sgpa: null, cgpa: 2.5 });
  assert.match(html, /Not applicable/);
  assert.match(html, /SGPA is not calculated for a backlog attempt/);
  assert.match(html, /original Regular SGPA remains unchanged/);
  assert.match(html, /2\.50/);
  const withValue = await ejs.renderFile(template, { ...values, examType: 'BACKLOG', sgpa: 7 });
  assert.match(withValue, /7\.00/);
  assert.doesNotMatch(withValue, /Not applicable/);
  const regular = await ejs.renderFile(template, { ...values, sgpa: null });
  assert.match(regular, /Unavailable/);
  assert.doesNotMatch(regular, /Not applicable/);
});
test('missing persisted result does not falsely claim success or failure', async () => {
  const html = await ejs.renderFile(template, { ...values, savedConfirmed: false, overallResult: null, cgpa: null, sgpa: null });
  assert.match(html, /Saved result unavailable/);
  assert.doesNotMatch(html, /is-confirmed|>FAIL<|Result imported successfully/);
  assert.doesNotMatch(html, /--piece:|id="replayImportCelebration"/);
});
test('student details remain escaped and motion has an accessible opt-out', async () => {
  const html = await ejs.renderFile(template, { ...values, studentName: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  const css = fs.readFileSync(path.join(__dirname, '../public/css/result-success.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
});

test('celebration replay restarts only celebration animations and honors reduced motion changes', () => {
  const handlers = {}, calls = [], motion = { matches: false, addEventListener(name, fn) { this.change = fn; } };
  const button = { hidden: false, addEventListener(name, fn) { handlers[name] = fn; } };
  const animations = ['import-confetti', 'import-confirm', 'import-check', 'import-arrive'].map(animationName => ({
    animationName, cancel() { calls.push('cancel:' + animationName); }, play() { calls.push('play:' + animationName); }
  }));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/results/success.js'), 'utf8'), {
    document: { getElementById: () => button, querySelector: () => ({ getAnimations: () => animations }) },
    window: { matchMedia: () => motion }
  });
  handlers.click();
  assert.equal(calls.length, 6);
  assert.ok(!calls.some(call => call.includes('import-arrive')));
  motion.matches = true; motion.change();
  assert.equal(button.hidden, true);
  handlers.click(); assert.equal(calls.length, 6);
});

test('celebration follows main-content bounds when the sidebar collapses or the viewport changes', () => {
  let left = 260, resize;
  const styles = {}, events = {};
  const main = { getBoundingClientRect: () => ({ left }), addEventListener(name, fn) { events[name] = fn; } };
  const celebration = { style: { setProperty(name, value) { styles[name] = value; } } };
  const button = { addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/results/success.js'), 'utf8'), {
    document: { getElementById: () => button, querySelector: () => ({ querySelector: () => celebration, closest: () => main }) },
    window: { innerWidth: 1440, addEventListener(name, fn) { events[name] = fn; }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe(target) { assert.equal(target, main); } }
  });
  assert.equal(styles['--celebration-left'], '260px');
  left = 72; resize();
  assert.equal(styles['--celebration-left'], '72px');
  left = 0; events.resize();
  assert.equal(styles['--celebration-left'], '0px');
});
