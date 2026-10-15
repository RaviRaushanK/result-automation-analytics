'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const template = path.join(__dirname, '../views/revaluation/outcome.ejs');
const values = { logStatus: 'success', events: [{ id: 1, srid: 2, no: 1, originalMarks: 40, revisedMarks: 60, originalStatus: 'fail', revisedStatus: 'pass', revisedGrade: 'B', isEffective: true, remarks: '' }],
  meta: { importId: 1, resultId: 2, studentName: 'TEST STUDENT', studentUsn: 'TEST001', sessionDisplay: 'June 2026', attemptNo: 1, examType: 'REGULAR', docUrl: null, sessionId: 1 },
  rows: [], aggregates: { overall_result: 'pass', sgpa: 7, cgpa: 7, failed_subject_count: 0 }, origResult: { sgpa: 4, cgpa: 4, result_status: 'fail', failed_subject_count: 1 },
  reviewedAt: null, reviewPresent: true, notice: null, error: null };

test('successful persisted revaluation displays the shared celebration while retaining outcome and history', async () => {
  const before = JSON.stringify(values);
  const html = await ejs.renderFile(template, values);
  assert.match(html, /Revaluation processed successfully/);
  assert.equal((html.match(/--piece:/g) || []).length, 96);
  assert.match(html, /replayImportCelebration/);
  assert.match(html, /js\/results\/success.js/);
  assert.match(html, /Revaluation event ledger/);
  assert.match(html, /unchanged by revaluation/);
  assert.equal(JSON.stringify(values), before);
});

test('pending, rejected, errored and missing-event outcomes never celebrate', async () => {
  for (const changes of [{ logStatus: 'pending' }, { logStatus: 'rejected' }, { error: 'Approval failed' }, { events: [] }]) {
    const html = await ejs.renderFile(template, { ...values, ...changes });
    assert.doesNotMatch(html, /import-celebration|replayImportCelebration|js\/results\/success.js/);
  }
});
