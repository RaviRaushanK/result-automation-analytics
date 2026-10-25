'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ejs = require('ejs');
const extractor = require('../services/revaluationExtractor');
const integrity = require('../services/revaluationIntegrity');
const scope = require('../services/revaluationScope');
const codes = ['MMC101', 'MMC102', 'MMC103', 'MMC104', 'MMC105', 'MMCL106'];

function fixture(documentCodes = ['MMC105'], examType = 'REGULAR') {
  const result = { result_id: 7, student_id: 1, exam_session_id: 20, attempt_no: examType === 'BACKLOG' ? 2 : 1,
    exam_type: examType, Student: { usn: '1MV25MC074', student_name: 'TEST STUDENT' },
    ExamSession: { semester: 1, exam_start_month: 12, exam_start_year: 2025, exam_end_month: 1, exam_end_year: 2026 },
    SubjectResults: codes.map((code, i) => ({ subject_result_id: i + 1, subject_id: i + 1, result_id: 7,
      internal_marks: 30, external_marks: 15, marks: 45, result_status: 'fail', grade: 'F',
      Subject: { subject_id: i + 1, subject_code: code, subject_name: code, exam_session_id: 20,
        subject_type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 } })) };
  const extracted = extractor.buildCandidates({ usn: result.Student.usn, name: result.Student.student_name,
    semester: 1, exam_session: 'Dec', exam_year: 2025, raw_text: 'UPDATED RESULTS AFTER REVALUATION Internal Old RV Final Marks',
    subjects: documentCodes.map(subjectCode => ({ subjectCode, internalMarks: 30, oldMarks: 15, oldResult: 'F',
      rvMarks: 20, rvResult: 'P', finalMarks: 20, finalResult: 'P' })), parser_warnings: [], lines: [] }, {
    studentUsn: result.Student.usn, studentName: result.Student.student_name,
    allSubjectResults: result.SubjectResults.map(sr => ({ ...sr, subject_code: sr.Subject.subject_code })) });
  // Use exact document period values, as supplied by the normalization stage.
  Object.assign(extracted.ocr, { exam_session: undefined, exam_year: undefined, ...result.ExamSession });
  const saved = { result_id: 7, student_id: 1, exam_session_id: 20,
    attempt: { attempt_no: result.attempt_no, exam_type: examType },
    // Reproduce a legacy upload containing the entire roster.
    subjects: result.SubjectResults.map(sr => ({ subject_result_id: sr.subject_result_id, subject_code: sr.Subject.subject_code })),
    ocr: extracted.ocr, documents: [] };
  const ocr = { extraction_id: 9, extracted_json: saved, validation_status: 'pending',
    async update(values) { Object.assign(this, values); }, set(key, value) { this[key] = value; }, async save() {} };
  const log = { import_id: 9, import_type: 'REVALUATION', status: 'extracted', OcrExtractions: [ocr], async update(values) { Object.assign(this, values); } };
  const events = [], loads = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' }, async commit() {}, async rollback() {} };
  const forbidden = () => assert.fail('Original academic records must not be written');
  const models = { Result: { async findByPk(id) { loads.push(id); assert.equal(Number(id), 7); return result; }, update: forbidden },
    SubjectResult: { async findAll(options) { return result.SubjectResults.filter(sr => options.where.subject_result_id.includes(sr.subject_result_id)); }, update: forbidden },
    Student: { update: forbidden }, ExamSession: {}, Subject: {},
    ImportLog: { async findByPk() { return log; } }, OcrExtraction: { async findByPk() { return ocr; } },
    AdminUser: { async findByPk() { return { admin_id: 1, role: 'admin', status: 'active' }; } },
    RevaluationResult: { async findAll() { return []; }, async findByPk() { return null; },
      async update() {}, async create(values) { events.push(values); return { ...values, revaluation_id: events.length }; } },
    sequelize: { async transaction() { return transaction; }, async query() { return [[{ next_no: 1 }]]; } } };
  const filename = path.resolve(__dirname, '../controllers/revaluationController.js');
  const localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, __dirname: path.dirname(filename),
    console: { log() {}, error() {}, warn() {} }, setTimeout,
    require: name => name === '../database/models' ? models : name === '../middlewares/upload' ? {}
      : name === './resultController' ? { _test: { gradeFromPercent: require('../services/academicPolicy').gradeFromPercent } } : localRequire(name) });
  async function invoke(method, body = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      redirect(url) { this.url = decodeURIComponent(url); }, render(view, locals) { this.view = view; this.locals = locals; } };
    await module.exports[method]({ params: { importId: '9' }, query: {}, session: { adminId: 1 },
      body: { source_token: integrity.digest(ocr.extracted_json), review_token: integrity.digest(ocr.extracted_json.review), ...body } }, res);
    return res;
  }
  const decisions = ids => Object.fromEntries(ids.flatMap(id => [[`decision_${id}`, 'accept'], [`internal_${id}`, '30'], [`external_${id}`, '20']]));
  return { result, saved, extracted, ocr, log, events, loads, invoke, decisions };
}

for (const documentCodes of [['MMC105'], ['MMC102', 'MMC105', 'MMCL106'], codes]) {
  test(`document scope controls extraction, legacy review, validation and approval: ${documentCodes.length} subjects`, async () => {
    const f = fixture(documentCodes), original = JSON.stringify(f.result);
    assert.deepEqual(f.extracted.ocr.subjects.map(row => row.subjectCode), documentCodes);
    assert.deepEqual(f.extracted.ocr.missing_subjects, []);
    const preview = await f.invoke('showReview');
    assert.deepEqual(Array.from(preview.locals.rows, row => row.code), codes);
    assert.deepEqual(Array.from(preview.locals.rows.filter(row => !row.evidence.manual_candidate), row => row.code), codes.filter(code => documentCodes.includes(code)));
    const html = await ejs.renderFile(path.resolve(__dirname, '../views/revaluation/review.ejs'), preview.locals);
    assert.match(html, new RegExp(`${documentCodes.length} subjects? verified`));
    assert.match(html, /0 mismatches[\s\S]*0 manual checks required/);
    assert.doesNotMatch(html, /SELECTED_BUT_NOT_FOUND/);
    const context = /verification-document-context">([\s\S]*?)<\/div>/.exec(html)[1];
    assert.match(context, /USN:<\/strong> 1MV25MC074 &mdash; Verified/);
    assert.match(html, /Examination period:<\/strong> Dec 2025 \/ Jan 2026 &mdash; Verified/);
    assert.match(html, /Attempt:<\/strong> 1 &mdash; Derived from stored history/);
    const activeTable = html.slice(html.indexOf('id="reviewTable"'));
    for (const code of codes.filter(code => !documentCodes.includes(code))) {
      const id = codes.indexOf(code) + 1;
      assert.ok(activeTable.includes(code), code);
      assert.match(activeTable, new RegExp(`id="reject_${id}"\\s+checked`));
      assert.match(activeTable, new RegExp(`id="int_${id}"[\\s\\S]*?value="30"[\\s\\S]*?disabled`));
    }
    const ids = documentCodes.map(code => codes.indexOf(code) + 1);
    assert.equal((await f.invoke('submitReview', f.decisions(ids))).url, '/revaluation/review/9');
    assert.deepEqual(Array.from(f.ocr.extracted_json.review.proposal, p => p.subject_result_id), ids);
    assert.match((await f.invoke('approveReview')).url, /outcome/);
    assert.deepEqual(f.events.map(event => event.subject_result_id), ids);
    assert.ok(f.events.every(event => event.revised_external_marks === 20 && event.revised_marks === 50));
    assert.equal(JSON.stringify(f.result), original);
  });
}

for (const documentCodes of [['XYZ999'], ['MMC105', 'XYZ999'], ['MMC105', 'MMC105']]) {
  test(`unknown, mixed or duplicate document rows block even forged acknowledgments: ${documentCodes.join(',')}`, async () => {
    const f = fixture(documentCodes);
    const preview = await f.invoke('showReview');
    assert.ok(preview.locals.meta.documentChecks.some(check => check.status === 'MISMATCH'));
    const html = await ejs.renderFile(path.resolve(__dirname, '../views/revaluation/review.ejs'), preview.locals);
    const summary = /data-verification-summary>([\s\S]*?)<\/div>/.exec(html)[1];
    if (documentCodes.length === 2) assert.match(summary, /1 mismatch/);
    assert.ok(html.includes(documentCodes.at(-1)), 'invalid extracted subject remains visible');
    const response = await f.invoke('submitReview', { ...f.decisions([5]), verify_old_status_XYZ999: '1', verify_document_context: '1' });
    assert.match(response.url, /error=/);
    assert.equal(f.ocr.validation_status, 'pending'); assert.equal(f.events.length, 0);
    assert.equal(f.saved.ocr.subjects.length, documentCodes.length, 'duplicate evidence is preserved');
  });
}

test('cross-session offerings and forged bindings are visible and cannot validate', async () => {
  for (const change of [f => { f.result.SubjectResults[4].Subject.exam_session_id = 99; },
    f => { f.saved.ocr.subjects[0].subject_result_id = 1; }]) {
    const f = fixture(); change(f);
    assert.equal(scope.resolve(f.saved, f.result).targets.size, 0);
    const preview = await f.invoke('showReview');
    assert.ok(preview.locals.meta.documentChecks.some(check => check.status === 'MISMATCH'));
    assert.match((await f.invoke('submitReview', f.decisions([5]))).url, /error=/);
    assert.equal(f.events.length, 0);
  }
});

test('backlog scope resolves only the selected attempt and final approval rechecks document membership', async () => {
  const f = fixture(['MMC105'], 'BACKLOG');
  const original = JSON.stringify(f.result);
  assert.equal((await f.invoke('submitReview', f.decisions([5]))).url, '/revaluation/review/9');
  // A stale/forged saved proposal may not add another owned roster subject.
  f.ocr.extracted_json.review.proposal.push({ ...f.ocr.extracted_json.review.proposal[0], subject_result_id: 1, bound_to_srid: 1 });
  assert.match((await f.invoke('approveReview')).url, /does not identify the accepted subject/);
  assert.equal(f.events.length, 0);
  f.ocr.extracted_json.review.proposal.pop();
  assert.match((await f.invoke('approveReview')).url, /outcome/);
  assert.deepEqual(f.events.map(event => event.subject_result_id), [5]);
  assert.ok(f.loads.every(id => Number(id) === 7)); assert.equal(JSON.stringify(f.result), original);
});

test('an empty document and forged decisions for absent roster subjects cannot create approval targets', async () => {
  const f = fixture([]);
  assert.ok((await f.invoke('showReview')).locals.rows.every(row => row.evidence.manual_candidate));
  assert.equal((await f.invoke('submitReview', f.decisions([1, 5]))).statusCode, 422);
  assert.equal(f.ocr.validation_status, 'pending'); assert.equal(f.events.length, 0);
});

test('normalized document codes resolve without an ID and preserve revised component evidence at approval', async () => {
  const f = fixture();
  f.saved.ocr.subjects[0].subjectCode = ' mmc-105 ';
  delete f.saved.ocr.subjects[0].subject_result_id;
  const preview = await f.invoke('showReview');
  assert.deepEqual(Array.from(preview.locals.rows.filter(row => !row.evidence.manual_candidate), row => row.code), ['MMC105']);
  assert.ok(!preview.locals.meta.documentChecks.some(check => check.status !== 'MATCH' && !check.derived));
  assert.equal((await f.invoke('submitReview', f.decisions([5]))).url, '/revaluation/review/9');
  assert.match((await f.invoke('approveReview')).url, /outcome/);
  assert.equal(f.events[0].revised_external_marks, 20); assert.equal(f.events[0].revised_marks, 50);
});

test('final approval blocks new unknown evidence and a changed original subject offering', async () => {
  for (const change of [f => { f.saved.ocr.subjects.push({ subjectCode: 'XYZ999', oldResult: 'F' }); },
    f => { f.result.SubjectResults[4].Subject.exam_session_id = 99; }]) {
    const f = fixture();
    assert.equal((await f.invoke('submitReview', f.decisions([5]))).url, '/revaluation/review/9');
    change(f);
    assert.match((await f.invoke('approveReview')).url, /error=/); assert.equal(f.events.length, 0);
  }
});

test('forged browser decisions and the legacy add-subject route cannot expand document scope', async () => {
  const f = fixture();
  const added = await f.invoke('addMissing', { subject_result_id: '1', card_internal_marks: '30', card_rv_marks: '20' });
  assert.match(added.url, /Confirm that this subject appears/);
  assert.equal(f.ocr.validation_status, 'pending');
  assert.equal((await f.invoke('submitReview', f.decisions([1, 5]))).statusCode, 422);
  assert.equal((await f.invoke('submitReview', f.decisions([5]))).url, '/revaluation/review/9');
  assert.deepEqual(Array.from(f.ocr.extracted_json.review.proposal, p => p.subject_result_id), [5]);
  assert.match((await f.invoke('approveReview')).url, /outcome/);
  assert.deepEqual(f.events.map(event => event.subject_result_id), [5]);
});

test('an OCR-missed subject can be explicitly added, entered, validated and approved with targeted verification', async () => {
  const f = fixture(), original = JSON.stringify(f.result), ocrEvidence = JSON.stringify(f.saved.ocr);
  assert.match((await f.invoke('addMissing', { subject_result_id: '1', confirm_on_card: '1' })).url, /edit=1/);
  assert.equal(f.ocr.validation_status, 'pending'); assert.equal(f.events.length, 0);
  assert.equal(JSON.stringify(f.ocr.extracted_json.ocr), ocrEvidence);
  const preview = await f.invoke('showReview');
  assert.deepEqual(Array.from(preview.locals.rows.filter(row => !row.evidence.manual_candidate), row => row.code), ['MMC101', 'MMC105']);
  const html = await ejs.renderFile(path.resolve(__dirname, '../views/revaluation/review.ejs'), preview.locals);
  assert.match(html, /Not detected by OCR &middot; Accept to enter marks from the card/);
  assert.match(html, /1 subject verified[\s\S]*0 manual checks required/);
  assert.match(html, /name="verify_manual_subject_1"/);
  const blocked = await f.invoke('submitReview', f.decisions([1, 5]));
  assert.equal(blocked.statusCode, 422); assert.equal(f.ocr.validation_status, 'pending');
  const validated = await f.invoke('submitReview', { ...f.decisions([1, 5]), verify_manual_subject_1: '1' });
  assert.equal(validated.url, '/revaluation/review/9', validated.locals?.error);
  const confirmed = await f.invoke('showReview');
  const confirmedHtml = await ejs.renderFile(path.resolve(__dirname, '../views/revaluation/review.ejs'), {
    ...confirmed.locals, formatGpa: require('../public/js/gpa-format').format
  });
  assert.match(confirmedHtml, /id="manual_issue_status_1">Manually confirmed<\/span>/);
  assert.match(confirmedHtml, /id="manualVerificationCount"[^>]*>&middot; 0 manual checks required/);
  assert.match(confirmedHtml, /id="manualConfirmedCount"\s*>&middot; 1 manually confirmed/);
  delete f.ocr.extracted_json.review.identity_verified.manual_subject_1;
  assert.match((await f.invoke('approveReview')).url, /Verify Manual subject MMC101/);
  assert.equal(f.events.length, 0);
  f.ocr.extracted_json.review.identity_verified.manual_subject_1 = true;
  assert.match((await f.invoke('approveReview')).url, /outcome/);
  assert.deepEqual(f.events.map(event => event.subject_result_id), [1, 5]);
  assert.equal(f.events[0].revised_external_marks, 20); assert.equal(JSON.stringify(f.result), original);
});

test('manual registration rejects duplicate/foreign targets, invalidates validation and is bound to the document', async () => {
  const f = fixture();
  assert.match((await f.invoke('addMissing', { subject_result_id: '99', confirm_on_card: '1' })).url, /does not belong/);
  assert.match((await f.invoke('addMissing', { subject_result_id: '5', confirm_on_card: '1' })).url, /already in the review/);
  await f.invoke('submitReview', f.decisions([5]));
  await f.invoke('addMissing', { subject_result_id: '1', confirm_on_card: '1' });
  assert.equal(f.ocr.validation_status, 'pending'); assert.equal((await f.invoke('showReview')).locals.mode, 'edit');
  assert.match((await f.invoke('approveReview')).url, /validate the review decisions/);
  f.ocr.extracted_json.documents = [{ sha256: 'changed-upload' }];
  assert.match((await f.invoke('submitReview', { ...f.decisions([1, 5]), verify_manual_subject_1: '1' })).url, /manual subject entry is stale/);
  assert.equal(f.events.length, 0);
});

test('Internal comes from the database and an undetected row activates manual verification only when accepted', async () => {
  const f = fixture();
  f.result.SubjectResults[4].internal_marks = 49; // Deliberately differs from the card's 30.
  f.result.SubjectResults[1].internal_marks = 34;
  const original = JSON.stringify(f.result);
  const preview = await f.invoke('showReview');
  const extracted = preview.locals.rows.find(row => row.srid === 5);
  const optional = preview.locals.rows.find(row => row.srid === 2);
  assert.equal(extracted.evidence.revised_int, 49);
  assert.equal(extracted.evidence.internalMarks, 30, 'raw card evidence remains unchanged');
  assert.equal(optional.evidence.revised_int, 34);
  assert.equal(optional.evidence.internalMarks, null);
  const html = await ejs.renderFile(path.resolve(__dirname, '../views/revaluation/review.ejs'), preview.locals);
  assert.match(html, /id="accept_5"\s+checked/);
  assert.match(html, /id="reject_2"\s+checked/);
  assert.match(html, /id="manual_issue_2"[^>]*hidden/);
  assert.match(html, /id="verify_manual_subject_2"[^>]*disabled/);
  const values = { ...f.decisions([2, 5]), internal_2: '34' };
  const blocked = await f.invoke('submitReview', values);
  assert.equal(blocked.statusCode, 422); assert.equal(f.ocr.extracted_json.manual_subjects, undefined);
  const rerender = await ejs.renderFile(path.resolve(__dirname, '../views/revaluation/review.ejs'), blocked.locals);
  assert.match(rerender, /id="manual_issue_2"[^>]*role="alert"\s*>/);
  assert.match(rerender, /MMC102 &mdash; <span id="manual_issue_status_2">MANUAL VERIFICATION REQUIRED/);
  assert.match(rerender, /I verified the Manual subject MMC102 against the original marks card/);
  assert.equal((await f.invoke('submitReview', { ...values, verify_manual_subject_2: '1' })).url, '/revaluation/review/9');
  assert.deepEqual(Array.from(f.ocr.extracted_json.review.proposal, row => row.subject_result_id), [2, 5]);
  assert.equal(f.ocr.extracted_json.manual_subjects.length, 1);
  assert.equal(JSON.stringify(f.ocr.extracted_json.ocr), JSON.stringify(f.saved.ocr));
  assert.match((await f.invoke('approveReview')).url, /outcome/);
  assert.deepEqual(f.events.map(event => event.subject_result_id), [2, 5]);
  assert.equal(f.events[0].revised_marks, 54); assert.equal(f.events[0].revised_external_marks, 20);
  assert.equal(JSON.stringify(f.result), original);
});

test('rejecting a previously registered manual subject does not require manual verification or approve it', async () => {
  const f = fixture();
  await f.invoke('addMissing', { subject_result_id: '2', confirm_on_card: '1' });
  assert.equal((await f.invoke('submitReview', f.decisions([5]))).url, '/revaluation/review/9');
  assert.match((await f.invoke('approveReview')).url, /outcome/);
  assert.deepEqual(f.events.map(event => event.subject_result_id), [5]);
});

test('review preserves subject-code order and database Internal zero/missing values without an OCR fallback', async () => {
  const f = fixture(codes.slice().reverse());
  f.result.SubjectResults.reverse();
  f.result.SubjectResults.find(sr => sr.subject_result_id === 1).internal_marks = 0;
  f.result.SubjectResults.find(sr => sr.subject_result_id === 2).internal_marks = null;
  delete f.result.SubjectResults.find(sr => sr.subject_result_id === 3).internal_marks;
  const preview = await f.invoke('showReview');
  assert.deepEqual(Array.from(preview.locals.rows, row => row.code), codes);
  assert.equal(preview.locals.rows[0].evidence.revised_int, 0);
  assert.equal(preview.locals.rows[1].evidence.revised_int, null);
  assert.equal(preview.locals.rows[2].evidence.revised_int, null);
  assert.ok(preview.locals.rows.every(row => row.evidence.internalMarks === 30));
});
