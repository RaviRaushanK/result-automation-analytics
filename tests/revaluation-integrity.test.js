'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const integrity = require('../services/revaluationIntegrity');
const common = require('../services/academicIntegrity');
const policy = require('../services/academicPolicy');
function fixture() {
  const subject = { subject_id: 1, subject_code: 'MMC101', max_internal: 50, max_external: 50, max_marks: 100, credits: 4 };
  const sr = { subject_result_id: 1, result_id: 7, subject_id: 1, internal_marks: 20, external_marks: 20, marks: 40, grade: 'F', result_status: 'fail', Subject: subject };
  const result = { result_id: 7, student_id: 7, exam_session_id: 20, exam_type: 'REGULAR', attempt_no: 1, sgpa: 0, cgpa: 0,
    Student: { usn: 'AUDIT001', student_name: 'AUDIT STUDENT' }, ExamSession: { semester: '1', exam_session: 'Dec', exam_year: 2025 }, SubjectResults: [sr] };
  const events = [], logs = new Map(); let tail = Promise.resolve();
  function draft(id, sha = 'document-' + id) {
    const saved = { result_id: 7, student_id: 7, exam_session_id: 20, attempt: { exam_type: 'REGULAR', attempt_no: 1 }, documents: [{ sha256: sha }],
      ocr: { extraction_status: 'extracted', student_candidates: { usn: 'AUDIT001' }, semester_candidate: 1,
        exam_session: 'Dec', exam_year: 2025, attempt_no: 1, exam_type: 'REGULAR',
        subjects: [{ subject_result_id: 1, subjectCode: 'MMC101', oldMarks: 20, oldResult: 'FAIL' }] },
      review: { version: 1, identity_verified: { usn: true, semester: true, period: true, old_marks: true, old_status: true }, target_snapshot: integrity.snapshot(result), submitted_by: 1,
        baselines: { 1: { marks: 40, status: 'fail' } }, proposal: [{ subject_result_id: 1, decision: 'accept',
          proposed_revised_internal_marks: 40, proposed_revised_external_marks: 40, proposed_revised_total_marks: 80 }] } };
    const ocr = { validation_status: 'validated', extracted_json: saved, set(key, value) { this[key] = value; }, save: async () => {} };
    const log = { import_id: id, import_type: 'REVALUATION', status: 'extracted', OcrExtractions: [ocr], update: async values => Object.assign(log, values) };
    logs.set(id, log); return saved;
  }
  const models = { OcrExtraction: {}, Result: { findByPk: async (id, options) => {
    assert.ok(options.include[2].attributes.includes('external_marks'), 'Approval must reload the stored original components, not just the total');
    if (options?.lock) { const previous = tail; tail = new Promise(resolve => { options.transaction.release = resolve; }); await previous; }
    return result;
  } }, SubjectResult: { findAll: async () => [sr] }, ImportLog: { findByPk: async id => logs.get(Number(id)) },
    AdminUser: { findByPk: async () => ({ admin_id: 1, role: 'admin', status: 'active' }) },
    RevaluationResult: { findAll: async () => events, update: async (values, options) => events.filter(row => row.subject_result_id === options.where.subject_result_id).forEach(row => { row.is_effective = false; }),
      create: async values => { const row = { ...values, revaluation_id: events.length + 1, save: async () => {} }; events.push(row); return row; },
      findByPk: async id => events.find(row => row.revaluation_id === id) },
    sequelize: { transaction: async () => ({ LOCK: { UPDATE: 'UPDATE' }, commit() { this.release?.(); }, rollback() { this.release?.(); } }),
      query: async (sql, options) => [[{ next_no: Math.max(0, ...events.filter(row => row.subject_result_id === options.replacements[0]).map(row => row.revaluation_no)) + 1 }]] } };
  const file = path.resolve(__dirname, '../controllers/revaluationController.js'), requireLocal = createRequire(file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nexports.supersedeForTest = supersedeRevaluationImport;', { module, exports: module.exports, __dirname: path.dirname(file), console: { error() {}, warn() {}, log() {} }, setTimeout,
    require: name => name === '../database/models' ? models : name === '../middlewares/upload' ? {}
      : name === './resultController' ? { _test: { gradeFromPercent: policy.gradeFromPercent } } : requireLocal(name) });
  async function approve(id, overrides = {}, actor = { adminId: 1 }) {
    const res = { redirect(url) { this.url = url; } };
    await module.exports.approveReview({ params: { importId: id }, session: actor,
      body: { review_token: integrity.digest(logs.get(id).OcrExtractions[0].extracted_json.review), ...overrides } }, res);
    return decodeURIComponent(res.url);
  }
  return { draft, approve, events, result, sr, models, logs, supersede: module.exports.supersedeForTest };
}
for (const [field, value] of [['usn', 'AUDIT002'], ['semester', 2], ['exam_session', 'Jun'], ['exam_year', 2026], ['attempt_no', 2], ['exam_type', 'BACKLOG'], ['oldMarks', 21], ['subjectCode', 'MMC102']]) {
  test('final approval rejects document contradiction: ' + field + ' even with forged confirmation', async () => {
    const f = fixture(), saved = f.draft(9), before = JSON.stringify(f.result);
    if (field === 'usn') saved.ocr.student_candidates.usn = value;
    else if (field === 'semester') saved.ocr.semester_candidate = value;
    else if (['oldMarks', 'oldResult', 'subjectCode'].includes(field)) saved.ocr.subjects[0][field] = value;
    else saved.ocr[field] = value;
    saved.identity_confirmed = true;
    assert.match(await f.approve(9), /error=/); assert.equal(f.events.length, 0); assert.equal(JSON.stringify(f.result), before);
  });
}
test('missing context is explicitly distinguishable and requires verification; a contradiction cannot be acknowledged away', () => {
  const f = fixture(), saved = f.draft(9); saved.ocr = { subjects: [] };
  assert.ok(integrity.checks(saved, f.result).every(check => check.status === 'NOT PRESENT IN DOCUMENT'));
  assert.ok(integrity.verify(saved, f.result, [], false).errors.length);
  assert.equal(integrity.verify(saved, f.result, [], true).errors.length, 0);
  saved.ocr.student_candidates = { usn: 'WRONG001' }; assert.ok(integrity.verify(saved, f.result, [], true).errors.length);
});
test('stale proposal token and changed original target cannot be approved', async () => {
  const f = fixture(), saved = f.draft(9), oldToken = integrity.digest(saved.review);
  saved.review.version++;
  assert.match(await f.approve(9, { review_token: oldToken }), /validated review changed/);
  f.sr.marks = 45;
  assert.match(await f.approve(9), /original student, attempt or subject configuration changed/);
  assert.equal(f.events.length, 0);
});
test('concurrent legitimate later documents keep both events and exactly one approved effective outcome', async () => {
  const f = fixture(); f.draft(9); f.draft(10); const original = JSON.stringify(f.result);
  const urls = await Promise.all([f.approve(9), f.approve(10)]);
  assert.ok(urls.every(url => /outcome/.test(url))); assert.equal(f.events.length, 2);
  assert.equal(f.events.filter(row => row.is_effective && row.revaluation_status === 'approved').length, 1);
  assert.deepEqual(f.events.map(row => row.revaluation_no), [1, 2]); assert.equal(JSON.stringify(f.result), original);
});
test('renamed identical document cannot create a second event; non-admin approval is rejected', async () => {
  const f = fixture(); f.draft(9, 'same-bytes'); f.draft(10, 'same-bytes');
  assert.match(await f.approve(9), /outcome/); assert.match(await f.approve(10), /already been approved/); assert.equal(f.events.length, 1);
  f.draft(11); f.models.AdminUser.findByPk = async () => ({ status: 'active', role: 'faculty' });
  assert.match(await f.approve(11), /active administrator/); assert.equal(f.events.length, 1);
});
for (const total of [0, 40, 80]) {
  test('valid revised delta is permitted at final approval: ' + (total - 40), async () => {
    const f = fixture(), saved = f.draft(9);
    Object.assign(saved.review.proposal[0], { proposed_revised_internal_marks: total / 2, proposed_revised_external_marks: total / 2, proposed_revised_total_marks: total });
    assert.match(await f.approve(9, { revaluation_status: 'rejected', is_effective: false }), /outcome/);
    assert.equal(f.events[0].revised_marks, total); assert.equal(f.events[0].revaluation_status, 'approved'); assert.equal(f.events[0].is_effective, true);
    assert.equal(f.sr.marks, 40);
  });
}
test('manual selection of a different owned subject cannot replace the document subject', () => {
  const f = fixture(), saved = f.draft(9);
  f.result.SubjectResults.push({ ...f.sr, subject_result_id: 2, subject_id: 2, Subject: { ...f.sr.Subject, subject_code: 'MMC102' } });
  assert.match(integrity.verify(saved, f.result, [{ subject_result_id: 2, decision: 'accept', source: 'MISSING_MANUAL' }], true).errors.join(' '), /does not identify the accepted subject/);
});
test('old external status requires explicit verification and is never confused with stored overall status', () => {
  const f = fixture(), saved = f.draft(9);
  saved.ocr.subjects[0].oldResult = 'PASS';
  assert.match(integrity.verify(saved, f.result, saved.review.proposal, false).errors.join(' '), /external result status is not stored separately/);
  assert.equal(integrity.verify(saved, f.result, saved.review.proposal, true).errors.length, 0);
  assert.equal(f.sr.result_status, 'fail');
});
test('explicit document revaluation number prevents reprocessing the same event after a changed file encoding', async () => {
  const f = fixture(), first = f.draft(9), second = f.draft(10);
  first.ocr.raw_text = 'Revaluation No: RV-001'; second.ocr.raw_text = 'Revaluation No: RV-001';
  assert.match(await f.approve(9), /outcome/); assert.match(await f.approve(10), /already been approved/); assert.equal(f.events.length, 1);
});
test('a later unprocessed subject on the same document is not blocked by another subject history', async () => {
  const f = fixture(), secondSubject = { ...f.sr, subject_result_id: 2, subject_id: 2, Subject: { ...f.sr.Subject, subject_code: 'MMC102' } };
  f.result.SubjectResults.push(secondSubject); f.models.SubjectResult.findAll = async () => f.result.SubjectResults;
  const first = f.draft(9, 'whole-card'), second = f.draft(10, 'whole-card');
  first.ocr.subjects.push({ ...first.ocr.subjects[0], subject_result_id: 2, subjectCode: 'MMC102' });
  second.ocr.subjects = first.ocr.subjects;
  second.review.proposal[0].subject_result_id = 2; second.review.baselines[2] = { marks: 40, status: 'fail' };
  assert.match(await f.approve(9), /outcome/); assert.match(await f.approve(10), /outcome/);
  assert.deepEqual(f.events.map(row => row.revaluation_no), [1, 1]);
  assert.equal(f.events.filter(row => row.is_effective).length, 2);
});
test('replacing an open revaluation draft preserves successful import history and its document evidence', async () => {
  const f = fixture(), deleted = [];
  f.models.sequelize.query = async () => [{ import_id: 1, status: 'success', extracted_json: { result_id: 7 } },
    { import_id: 9, status: 'extracted', extracted_json: { result_id: 7 } }];
  f.models.OcrExtraction.destroy = async options => deleted.push(['ocr', options.where.import_id]);
  f.models.ImportLog.destroy = async options => deleted.push(['log', options.where.import_id]);
  const result = await f.supersede(7, {});
  assert.equal(result.deletedImportId, 9); assert.deepEqual(deleted, [['ocr', 9], ['log', 9]]);
});
test('approval without an authoritative reviewer identity cannot use an implicit default administrator', async () => {
  const f = fixture(); f.draft(9);
  assert.match(await f.approve(9, {}, {}), /administrator reviewer is required/); assert.equal(f.events.length, 0);
});
test('missing/deleted authoritative student cannot be approved by acknowledging an absent document USN', async () => {
  const f = fixture(); f.result.Student = null;
  const saved = f.draft(9); saved.ocr.student_candidates = {};
  assert.match(await f.approve(9), /authoritative original student or examination context is unavailable/); assert.equal(f.events.length, 0);
});
test('a soft-deleted reviewer cannot approve through a stale authenticated session', async () => {
  const f = fixture(); f.draft(9);
  f.models.AdminUser.findByPk = async () => ({ admin_id: 1, status: 'active', role: 'admin', deleted_at: '2026-01-01' });
  assert.match(await f.approve(9), /active administrator/); assert.equal(f.events.length, 0);
});
test('missing authoritative course cannot be approved using fallback mark limits', async () => {
  const f = fixture(); delete f.sr.Subject;
  const saved = f.draft(9); saved.ocr.subjects = [];
  assert.match(await f.approve(9), /authoritative original subject offering is unavailable/); assert.equal(f.events.length, 0);
});
for (const value of ['50abc', '1e2', '0x10', '', null, -1, 101, NaN, Infinity, [], {}, '35.5', 35.5, Number.MAX_SAFE_INTEGER + 1]) {
  test('strict revised marks reject ' + JSON.stringify(value), () => {
    const parsed = common.mark(value); assert.ok(!parsed.present || parsed.invalid || parsed.value > 100);
  });
}
