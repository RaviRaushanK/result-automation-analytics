'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../database/models');
const controller = require('../controllers/resultController');
const outcomes = require('../services/academicOutcomeService');
after(() => db.sequelize.close());

test('registration-blocked Review prevents keyboard or scripted submission in the client', () => {
  let submit, prevented = false, alerted = false;
  const form = { dataset: { registrationBlocked: 'true' }, addEventListener(name, handler) { if (name === 'submit') submit = handler; } };
  const alert = { scrollIntoView() { alerted = true; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/results/review.js'), 'utf8'), {
    document: { addEventListener(name, handler) { if (name === 'DOMContentLoaded') handler(); }, querySelectorAll: () => [],
      getElementById: id => id === 'reviewForm' ? form : id === 'resultValidationAlert' ? alert : null }
  });
  submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(alerted, true);
});

async function fixture(student, run) {
  const restores = [], updates = [];
  let rolledBack = false;
  const replace = (object, name, value) => { const previous = object[name]; object[name] = value; restores.push(() => { object[name] = previous; }); };
  const session = { session_id: 1, batch_id: 1, semester: '1', exam_session: 'Jun', exam_year: 2026, Batch: { batch_name: 'MCA 2025' } };
  const definition = { subject_id: 1, course_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 100, max_marks: 150 };
  const course = { ...definition, semester: '1', status: 'active', is_required: true, roster_verified: true };
  replace(db.ImportLog, 'findByPk', async () => ({ import_id: 9, file_name: 'test.pdf', file_type: 'pdf', ResultSession: session }));
  replace(db.OcrExtraction, 'findOne', async () => ({ extracted_json: { student: { usn: 'TEST001', name: 'Test Student' }, attempt: { attempt_no: 1, exam_type: 'REGULAR' }, subjects: [{ subject_id: 1, internalMarks: 42, externalMarks: 34 }] }, update: async data => updates.push(data) }));
  replace(db.Subject, 'findAll', async () => [definition]);
  replace(db.AcademicCourse, 'findAll', async () => [course]);
  replace(db.Student, 'findOne', async options => { assert.notEqual(options.paranoid, false); return student; });
  replace(db.Result, 'findOne', async () => null);
  replace(outcomes, 'load', async () => ({ courses: [course], results: [], subjects: [] }));
  for (const [object, method] of [[db.Student, 'create'], [db.Result, 'create'], [db.SubjectResult, 'bulkCreate']]) {
    replace(object, method, () => { assert.fail('No student or academic result may be written'); });
  }
  replace(db.sequelize, 'transaction', async () => ({ rollback: async () => { rolledBack = true; }, commit: async () => assert.fail('Must not commit a blocked import') }));
  const invoke = async (method, options = {}) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, render(view, locals) { this.view = view; this.locals = locals; }, redirect(url) { this.url = url; } };
    await controller[method]({ params: { importId: '9' }, query: {}, body: { usn: 'test001', name: 'Test Student', internal_1: 42, external_1: 34 }, ...options }, response);
    return response;
  };
  try { await run({ invoke, updates, isRolledBack: () => rolledBack }); }
  finally { restores.reverse().forEach(restore => restore()); }
}

for (const [name, student] of [['missing or deleted student', null], ['student registered in a different batch', { student_id: 1, batch_id: 2 }]]) {
  test(`${name}: validation stays on Review with an alert instead of opening preview`, async () => {
    await fixture(student, async ({ invoke, updates }) => {
      const response = await invoke('validateReview');
      assert.equal(response.statusCode, 422);
      assert.equal(response.view, 'results/review');
      assert.match(response.locals.formError, /TEST001 is not registered in MCA 2025/);
      assert.equal(response.locals.registrationBlocked, true);
      assert.equal(updates[0].validation_status, 'pending');
      const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), response.locals);
      assert.match(html, /role="alert"/);
      assert.match(html, /Add or restore the student in this batch/);
      assert.match(html, /id="validateButton"[^>]*\sdisabled(?:\s|>)/);
      assert.match(html, /data-registration-blocked="true"/);
      assert.match(html, /refresh Review to enable validation/);
    });
  });

  test(`${name}: direct preview and direct save cannot bypass registration`, async () => {
    await fixture(student, async ({ invoke, isRolledBack }) => {
      const preview = await invoke('showPreviewPage');
      assert.match(preview.url, /^\/results\/upload\/9\/review\?error=/);
      assert.match(decodeURIComponent(preview.url), /not registered in MCA 2025/);
      const save = await invoke('confirmImport');
      assert.match(decodeURIComponent(save.url), /not registered in MCA 2025/);
      assert.equal(isRolledBack(), true);
      const review = await invoke('showReviewPage');
      assert.match(review.locals.formError, /not registered in MCA 2025/);
      assert.equal(review.locals.registrationBlocked, true);
    });
  });
}

test('registered student in the selected batch can validate and preview with calculated CGPA', async () => {
  await fixture({ student_id: 1, batch_id: 1 }, async ({ invoke, updates }) => {
    const validation = await invoke('validateReview');
    assert.equal(validation.url, '/results/upload/9/preview');
    assert.equal(updates[0].validation_status, 'validated');
    const preview = await invoke('showPreviewPage');
    assert.equal(preview.view, 'results/preview');
    assert.equal(preview.locals.data.cgpa, 5);
    const review = await invoke('showReviewPage');
    assert.equal(review.locals.registrationBlocked, false);
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), review.locals);
    assert.doesNotMatch(html, /id="validateButton"[^>]*\sdisabled(?:\s|>)/);
  });
});
