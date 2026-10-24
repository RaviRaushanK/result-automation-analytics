'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ejs = require('ejs');
const diagnostics = require('../services/extractionReviewDiagnostics');
const integrity = require('../services/academicIntegrity');

const warning = 'Vision reading was incomplete or unavailable on some pages. Verify the extracted rows against the card.';
const period = { exam_start_month: 12, exam_start_year: 2025, exam_end_month: 1, exam_end_year: 2026 };
function fixture() {
  const subjects = [1, 2].map(id => ({ subject_id: id, subject_code: 'MMC10' + id, max_internal: 50, max_external: 50,
    max_marks: 100, internalMarks: 30, externalMarks: 20, found_on_card: true, confidence: 'high' }));
  return { subjects, saved: { subjects, warnings: [warning], integrity_conflicts: [], excluded_subjects: [],
    student: { usn: 'TEST001', name: 'TEST STUDENT' }, attempt: { exam_type: 'REGULAR', attempt_no: 1 },
    document_evidence: { usns: ['TEST001'], semesters: [1], periods: [period] } }, warnings: [warning] };
}
const templatePath = path.join(__dirname, '../views/results/review.ejs');
const template = fs.readFileSync(templatePath, 'utf8');
const header = template.slice(template.indexOf("<% if (typeof warnings"), template.indexOf("<% if (typeof formError"));
const render = (result, extractionWarning = null) => ejs.render(header, {
  warnings: result.warnings, extractionDiagnostics: result.diagnostics, extractionWarning
}, { filename: templatePath });

test('complete recovered rows move known stage issues to details, including legacy drafts without page diagnostics', () => {
  const input = fixture(), before = JSON.stringify(input);
  const result = diagnostics.classify(input);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.diagnostics[0].severity, 'info');
  assert.equal(result.diagnostics[0].status, 'recovered');
  assert.equal(result.diagnostics[0].original_message, warning);
  const html = render(result);
  assert.match(html, /Extraction details/);
  assert.match(html, /final subject data was recovered successfully/);
  assert.doesNotMatch(html, /alert-warning|role="alert"|page \d/i);
  assert.match(html, /MATCH apply only to those identity fields/);
  assert.equal(JSON.stringify(input), before);
});

test('missing subjects, missing/malformed marks, and low confidence keep stage warnings prominent', () => {
  for (const change of [
    f => { f.subjects = [...f.subjects, { subject_id: 3, max_internal: 50, max_external: 50, max_marks: 100, internalMarks: '', externalMarks: '' }]; },
    f => { f.subjects[0].internalMarks = ''; },
    f => { f.subjects[0].externalMarks = null; },
    f => { f.subjects[0].externalMarks = '20abc'; },
    f => { f.subjects[0].externalMarks = 51; },
    f => { f.saved.subjects[0].found_on_card = false; },
    f => { f.saved.subjects[0].confidence = 'low'; },
    f => { f.hasUnresolvedFields = true; }
  ]) {
    const input = fixture(); change(input);
    const result = diagnostics.classify(input);
    assert.deepEqual(result.warnings, [warning]);
    assert.deepEqual(result.diagnostics, []);
    assert.match(render(result, 'Required marks or subject coverage are incomplete.'), /alert-warning/);
  }
});

test('conflicts, other warnings, and identity mismatches cannot be downgraded', () => {
  for (const change of [
    f => { f.saved.integrity_conflicts = ['Conflicting readings']; },
    f => { f.warnings.push('AI readings disagree on marks for MMC101.'); },
    f => { f.warnings.push('AI reconciliation was unavailable. Verify the remaining extraction against the original card.'); },
    f => { f.saved.excluded_subjects = [{ subject_code: 'OTHER' }]; },
    f => { f.documentChecks = [{ field: 'USN', status: 'MISMATCH' }]; }
  ]) {
    const input = fixture(); change(input);
    const result = diagnostics.classify(input);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.warnings, input.warnings);
    assert.match(render(result), /alert-warning/);
  }
});

test('new draft diagnostics retain actual stage evidence and conservatively verify retake coverage', () => {
  const input = fixture();
  const source = { stages: { vision: { status: 'failed', pages: [{ page: 1, status: 'failed' }] }, llm: { status: 'ok' } },
    warnings: [warning], subjects: input.subjects.map(row => ({ subjectCode: row.subject_code, internalMarks: row.internalMarks,
      externalMarks: row.externalMarks, result: 'P', marksValidated: true })) };
  input.saved.extraction_diagnostics = diagnostics.capture(source);
  assert.deepEqual(input.saved.extraction_diagnostics.stages, source.stages);
  input.retake = true;
  assert.equal(diagnostics.classify(input).diagnostics.length, 1);
  input.warnings = []; // Evidence survives a review save that replaces general warnings.
  assert.equal(diagnostics.classify(input).diagnostics.length, 1);
  input.saved.extraction_diagnostics.source_subject_count = 3;
  assert.equal(diagnostics.classify(input).warnings.length, 1);
  input.saved.extraction_diagnostics = diagnostics.capture({ ...source, subjects: [{ ...source.subjects[0], internalMarks: null }] });
  assert.equal(diagnostics.classify(input).warnings.length, 1);
  delete input.saved.extraction_diagnostics;
  input.warnings = [warning];
  assert.equal(diagnostics.classify(input).warnings.length, 1);
});

test('period display labels do not change canonical comparisons or mismatch blocking', () => {
  const target = { ...period, semester: 1, usn: 'TEST001', attempt_no: 1, exam_type: 'REGULAR' };
  const evidence = fixture().saved.document_evidence;
  const check = integrity.summary(evidence, target).find(row => row.key === 'period');
  assert.equal(check.document, '2025-12-2026-1');
  assert.equal(check.documentLabel, 'Dec 2025 / Jan 2026');
  assert.equal(check.status, 'MATCH');
  const mismatch = { ...target, exam_start_month: 5, exam_start_year: 2026, exam_end_month: 6 };
  const checks = integrity.summary(evidence, mismatch);
  assert.equal(checks.find(row => row.key === 'period').status, 'MISMATCH');
  const start = template.indexOf('    <div class="alert alert-info">', template.indexOf('id="reviewForm"'));
  const block = template.slice(start, template.indexOf('    <div class="result-review-layout">', start));
  const html = ejs.render(block, { documentChecks: checks, excludedSubjects: [] });
  assert.match(html, /Dec 2025 \/ Jan 2026/);
  assert.match(html, /May \/ Jun 2026/);
  assert.doesNotMatch(html, /2025-12-2026-1/);
  assert.match(html, /Confirmation is blocked/);
  const errors = integrity.originalDocumentErrors({ document_evidence: evidence }, mismatch, { usn: 'TEST001' }, target,
    { usn: true, semester: true, period: true }, false);
  assert.ok(errors.length);
  assert.match(errors.join(' '), /Dec 2025 \/ Jan 2026/);
  assert.doesNotMatch(errors.join(' '), /2025-12-2026-1/);
});

test('Result Review controller classifies actual draft warnings using fresh roster coverage', async () => {
  const f = fixture();
  const dbSubjects = f.subjects.map(row => ({ ...row }));
  const examSession = { ...period, exam_session_id: 1, semester: 1, batch_id: 1, Batch: { batch_name: 'MCA 2025' } };
  const models = { ImportLog: { findByPk: async () => ({ import_id: 20, ExamSession: examSession, file_name: 'card.pdf', file_type: 'pdf' }) },
    OcrExtraction: { findOne: async () => ({ extracted_json: f.saved }) }, Subject: { findAll: async () => dbSubjects },
    Student: { findOne: async () => ({ student_id: 1, batch_id: 1 }) } };
  const file = path.join(__dirname, '../controllers/resultController.js'), localRequire = createRequire(file);
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models
    : ['../services/documentExtractor', '../services/academicConfiguration', '../services/academicOutcomeService', '../services/resultHistoryService'].includes(name) ? {} : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  let locals;
  const res = { render(view, data) { assert.equal(view, 'results/review'); locals = data; }, status() { return this; } };
  await context.module.exports.showReviewPage({ params: { importId: 20 }, query: {} }, res);
  assert.equal(locals.warnings.length, 0);
  assert.equal(locals.extractionDiagnostics.length, 1);
  assert.equal(locals.documentChecks.filter(row => row.status === 'MATCH').length, 3);
  dbSubjects.push({ subject_id: 3, max_internal: 50, max_external: 50, max_marks: 100 });
  await context.module.exports.showReviewPage({ params: { importId: 20 }, query: {} }, res);
  assert.equal(locals.warnings.length, 1);
  assert.match(locals.extractionWarning, /missing marks/);
});
