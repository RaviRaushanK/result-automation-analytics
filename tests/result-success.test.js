'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const template = path.join(__dirname, '../views/results/success.ejs');
const values = { savedConfirmed: true, studentName: 'Test Student', usn: '1MV25MC061', sessionDisplay: 'MCA 2025 - June 2026', attemptNo: 1, examType: 'REGULAR', subjectsCount: 6, overallResult: 'pass', sgpa: 8, cgpa: 8.25 };
test('success page shows saved metrics, import details and existing next actions', async () => {
  const html = await ejs.renderFile(template, values);
  for (const text of ['Result imported successfully', '1MV25MC061', '8.00', '8.25', 'PASS', 'is-confirmed', '/results/upload', '/results/logs']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /card-body|border-success/);
  assert.equal((html.match(/--piece:/g) || []).length, 36);
  assert.match(html, /replayImportCelebration/);
});
test('missing GPA stays unavailable and zero remains a valid saved metric', async () => {
  const html = await ejs.renderFile(template, { ...values, sgpa: 0, cgpa: null });
  assert.match(html, /0\.00/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Complete verified course and grading history/);
  assert.doesNotMatch(html, /NaN/);
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
