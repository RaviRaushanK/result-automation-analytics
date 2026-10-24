'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const template = path.join(__dirname, '../views/revaluation/outcome.ejs');
const values = { formatGpa: require('../public/js/gpa-format').format, logStatus: 'success', events: [{ id: 1, srid: 2, no: 1, originalMarks: 40, revisedMarks: 60, originalStatus: 'fail', revisedStatus: 'pass', revisedGrade: 'B', isEffective: true, remarks: '' }],
  meta: { importId: 1, resultId: 2, studentName: 'TEST STUDENT', studentUsn: 'TEST001', sessionDisplay: 'June 2026', attemptNo: 1, examType: 'REGULAR', docUrl: null, examSessionId: 1 },
  rows: [], aggregates: { overall_result: 'pass', sgpa: 7, cgpa: 7, failed_subject_count: 0 }, origResult: { sgpa: 4, cgpa: 4, result_status: 'fail', failed_subject_count: 1 },
  reviewedAt: null, reviewPresent: true, notice: null, error: null };

test('successful persisted revaluation displays the shared celebration while retaining outcome and history', async () => {
  const before = JSON.stringify(values);
  const html = await ejs.renderFile(template, values);
  assert.match(html, /Revaluation processed successfully/);
  assert.equal((html.match(/--piece:/g) || []).length, 96);
  assert.match(html, /replayImportCelebration/);
  assert.match(html, /js\/results\/success.js/);
  assert.match(html, /Saved revaluation changes/);
  assert.match(html, /unchanged by revaluation/);
  assert.equal(JSON.stringify(values), before);
});

test('completion shows readable subject changes and collapsed audit references without raw metadata', async () => {
  const event = { ...values.events[0], subjectCode: 'MMC105', subjectName: 'WEB TECHNOLOGIES', remarks: JSON.stringify({ import_id: 24,
    event_fingerprint: 'PRIVATE_TECHNICAL_FINGERPRINT', base_remarks: 'OCR metadata', event_ids: [2] }) };
  const input = { ...values, events: [event, { ...event, id: 3, no: 2, subjectCode: '<script>alert(1)</script>', isEffective: false }] };
  const before = JSON.stringify(input);
  const html = await ejs.renderFile(template, input);
  assert.match(html, /MMC105/);
  assert.match(html, /<strong>MMC105 — WEB TECHNOLOGIES<\/strong>\s*<div>Revaluation record ID: 1<\/div>\s*<div>Original result record ID: 2<\/div>/);
  assert.match(html, /Revaluation no\./);
  assert.match(html, />Applied<\/span>/);
  assert.match(html, />Not current<\/span>/);
  assert.match(html, /<details>\s*<summary>Audit references<\/summary>/);
  assert.match(html, /These IDs identify saved records; they are not marks/);
  assert.match(html, /Import record ID: 1/);
  assert.doesNotMatch(html, /event_fingerprint|PRIVATE_TECHNICAL_FINGERPRINT|base_remarks|subject_result_id/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(JSON.stringify(input), before);
});

test('unresolved event subjects retain their audit identifiers without borrowing another outcome subject', async () => {
  const input = { ...values, events: [{ ...values.events[0], id: 2, srid: 60 }],
    rows: [{ srid: 61, code: 'OTHER101', name: 'UNRELATED COURSE', credits: 4, maxMarks: 100,
      origMarks: 40, origStatus: 'fail', origGrade: 'F', effective: { marks: 40, status: 'fail', grade: 'F' }, changed: false }] };
  const html = await ejs.renderFile(template, input);
  assert.match(html, /<strong>Subject name unavailable<\/strong>\s*<div>Revaluation record ID: 2<\/div>\s*<div>Original result record ID: 60<\/div>/);
  const audit = html.slice(html.indexOf('<summary>Audit references</summary>'));
  assert.doesNotMatch(audit, /UNRELATED COURSE|OTHER101/);
});

test('outcome controller passes code and name from the event association and preserves genuine missing relations', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
  const file = path.join(__dirname, '../controllers/revaluationController.js'), localRequire = createRequire(file);
  const events = [
    { revaluation_id: 2, subject_result_id: 60, revaluation_no: 1, original_marks: 45, revised_marks: 50,
      original_status: 'fail', revised_status: 'pass', revised_grade: 'C', is_effective: true,
      SubjectResult: { subject_result_id: 60, Subject: { subject_code: 'MMC105', subject_name: 'WEB TECHNOLOGIES' } } },
    { revaluation_id: 3, subject_result_id: 61, revaluation_no: 1, original_marks: 40, revised_marks: 50, SubjectResult: null },
    { revaluation_id: 4, subject_result_id: 62, revaluation_no: 1, original_marks: 40, revised_marks: 50, SubjectResult: { Subject: null } }
  ];
  const models = { SubjectResult: {}, Subject: {}, Result: { findByPk: async () => values.origResult },
    RevaluationResult: { findAll: async query => {
      assert.equal(query.include[0].model, models.SubjectResult);
      assert.equal(query.include[0].include[0].model, models.Subject);
      assert.deepEqual(Array.from(query.where.revaluation_id), [2, 3, 4]);
      return events;
    } } };
  const state = { ok: true, saved: { exam_session_id: 1, review: { event_ids: [2, 3, 4] } },
    result: { result_id: 2 }, log: { status: 'success' }, rows: [], meta: { ...values.meta, importId: 24 } };
  const module = { exports: {} };
  const context = { module, exports: module.exports, __dirname: path.dirname(file), console, fixtureState: state,
    require: name => name === '../database/models' ? models : name === '../middlewares/upload' ? {}
      : name === './resultController' ? { _test: { gradeFromPercent: require('../services/academicPolicy').gradeFromPercent } } : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nloadReviewState = async () => fixtureState;', context);
  let output;
  await module.exports.showOutcome({ params: { importId: 24 }, query: {} }, { render(view, data) { output = data; } });
  assert.equal(output.events[0].subjectCode, 'MMC105');
  assert.equal(output.events[0].subjectName, 'WEB TECHNOLOGIES');
  assert.equal(output.events[0].id, 2); assert.equal(output.events[0].srid, 60);
  assert.equal(output.events[0].originalMarks, 45); assert.equal(output.events[0].revisedMarks, 50);
  assert.equal(output.events[1].subjectName, ''); assert.equal(output.events[2].subjectName, '');
  const html = await ejs.renderFile(template, { formatGpa: require('../public/js/gpa-format').format, ...output });
  assert.match(html, /<strong>MMC105 — WEB TECHNOLOGIES<\/strong>\s*<div>Revaluation record ID: 2<\/div>\s*<div>Original result record ID: 60<\/div>/);
  assert.match(html, /<strong>Subject name unavailable<\/strong>\s*<div>Revaluation record ID: 3<\/div>\s*<div>Original result record ID: 61<\/div>/);
  assert.match(html, /<strong>Subject name unavailable<\/strong>\s*<div>Revaluation record ID: 4<\/div>\s*<div>Original result record ID: 62<\/div>/);
  state.rows = [{ srid:99, code:'OTHER',name:'UNCHANGED ORIGINAL',credits:4,maxMarks:100,origMarks:51,origGrade:'F',origStatus:'fail' }];
  await module.exports.showOutcome({params:{importId:24},query:{}},{render(view,data){output=data;}});
  assert.equal(output.rows[0].effective.status,'fail');
  assert.equal(output.rows[0].effective.grade,'F');
  assert.equal(output.aggregates.overall_result,'fail');
  assert.equal(output.aggregates.failed_subject_count,1);
  assert.equal(output.aggregates.sgpa,0);
});

test('pending, rejected, errored and missing-event outcomes never celebrate', async () => {
  for (const changes of [{ logStatus: 'pending' }, { logStatus: 'rejected' }, { error: 'Approval failed' }, { events: [] }]) {
    const html = await ejs.renderFile(template, { ...values, ...changes });
    assert.doesNotMatch(html, /import-celebration|replayImportCelebration|js\/results\/success.js/);
  }
});
