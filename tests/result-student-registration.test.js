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

test('incorrect extracted name is reported only on Validate and remains editable', async () => {
  const student = { student_id: 1, batch_id: 1, student_name: 'AMRUTHA S' };
  await fixture(student, async ({ invoke, updates, ocr }) => {
    const initial = await invoke('showReviewPage');
    assert.equal(initial.locals.formError, null);
    assert.equal(initial.locals.errors['student.name'], undefined);
    const failed = await invoke('validateReview');
    assert.equal(failed.statusCode, 422);
    assert.equal(failed.view, 'results/review');
    assert.equal(failed.locals.student.usn, '1MV25MC004');
    assert.equal(failed.locals.student.name, 'AMRUTHA SLOP');
    assert.match(failed.locals.formError, /name does not match USN 1MV25MC004/);
    assert.match(failed.locals.formError, /Registered name: AMRUTHA S\./);
    assert.equal(failed.locals.registrationBlocked, false);
    assert.equal(failed.locals.extractionWarning, null);
    assert.equal(updates.at(-1).validation_status, 'pending');
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), failed.locals);
    assert.match(html, /<strong>Validation Failed<\/strong>/);
    assert.match(html, /data-server-invalid="true" aria-invalid="true"/);
    assert.match(html, /data-server-rendered="true"/);
    assert.doesNotMatch(html, /id="validateButton"[^>]*\sdisabled(?:\s|>)/);
    const corrected = await invoke('validateReview', { body: { usn: '1mv25mc004', name: 'AMRUTHA S', internal_1: 42, external_1: 34 } });
    assert.equal(corrected.url, '/results/upload/9/preview');
    assert.equal(ocr.validation_status, 'validated');
    assert.equal(ocr.extracted_json.student.name, 'AMRUTHA S');
    assert.equal((await invoke('showPreviewPage')).view, 'results/preview');
    assert.equal(student.student_name, 'AMRUTHA S');
  }, { usn: '1MV25MC004', name: 'AMRUTHA SLOP' });
});

test('direct preview and final import cannot bypass a mismatched name in validated staging', async () => {
  await fixture({ student_id: 1, batch_id: 1, student_name: 'AMRUTHA S' }, async ({ invoke, ocr, isRolledBack }) => {
    ocr.validation_status = 'validated';
    for (const method of ['showPreviewPage', 'confirmImport']) {
      const response = await invoke(method);
      assert.match(decodeURIComponent(response.url), /name does not match USN 1MV25MC004/);
    }
    assert.equal(isRolledBack(), true);
    const review = await invoke('showReviewPage', { query: { error: 'Student identity mismatch.' } });
    assert.match(review.locals.errors['student.name'], /Registered name: AMRUTHA S/);
    assert.equal(review.locals.registrationBlocked, false);
  }, { usn: '1MV25MC004', name: 'AMRUTHA SLOP' });
});

for (const name of ['amrutha s', '  AMRUTHA   S  ', 'Amrutha\tS']) {
  test('name comparison accepts harmless case/whitespace differences: ' + JSON.stringify(name), async () => {
    await fixture({ student_id: 1, batch_id: 1, student_name: 'AMRUTHA S' }, async ({ invoke }) => {
      assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
    }, { usn: '1mv25mc004', name });
  });
}

for (const name of ['AMRUTHA SLOP', 'AMRUTHAS', 'AMRUTHA', 'ANOTHER STUDENT']) {
  test('name comparison does not accept partial or fuzzy identity matches: ' + name, async () => {
    await fixture({ student_id: 1, batch_id: 1, student_name: 'AMRUTHA S' }, async ({ invoke, updates }) => {
      assert.equal((await invoke('validateReview')).statusCode, 422);
      assert.equal(updates.at(-1).validation_status, 'pending');
    }, { usn: '1MV25MC004', name });
  });
}

test('a registered-name change after validation is rechecked before preview and save', async () => {
  const student = { student_id: 1, batch_id: 1, student_name: 'AMRUTHA S' };
  await fixture(student, async ({ invoke, isRolledBack }) => {
    assert.equal((await invoke('validateReview')).url, '/results/upload/9/preview');
    student.student_name = 'CORRECTED OFFICIAL NAME';
    assert.match(decodeURIComponent((await invoke('showPreviewPage')).url), /Registered name: CORRECTED OFFICIAL NAME/);
    assert.match(decodeURIComponent((await invoke('confirmImport')).url), /Registered name: CORRECTED OFFICIAL NAME/);
    assert.equal(isRolledBack(), true);
  }, { usn: '1MV25MC004', name: 'AMRUTHA S' });
});

test('missing registered name fails closed instead of skipping identity verification', async () => {
  await fixture({ student_id: 1, batch_id: 1, student_name: '' }, async ({ invoke, updates }) => {
    const response = await invoke('validateReview');
    assert.equal(response.statusCode, 422);
    assert.match(response.locals.formError, /registered name.*unavailable/);
    assert.equal(updates.at(-1).validation_status, 'pending');
  });
});

test('correcting a rejected USN enables another server validation attempt', () => {
  let submit, editUsn;
  const form = { dataset: { registrationBlocked: 'true' }, addEventListener(name, handler) { if (name === 'submit') submit = handler; } };
  const usn = { value: '1IMV25MC074', classList: { remove() {} }, addEventListener(name, handler) { if (name === 'input') editUsn = handler; } };
  const button = { disabled: true, removeAttribute(name) { assert.equal(name, 'aria-describedby'); } };
  const hint = { hidden: false };
  const elements = { reviewForm: form, usnInput: usn, validateButton: button, studentRegistrationHint: hint };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/results/review.js'), 'utf8'), {
    document: { addEventListener(name, handler) { if (name === 'DOMContentLoaded') handler(); }, querySelectorAll: () => [],
      getElementById: id => elements[id] || null }
  });
  editUsn.call(usn);
  assert.equal(button.disabled, true);
  usn.value = '1MV25MC074';
  editUsn.call(usn);
  assert.equal(button.disabled, false);
  assert.equal(form.dataset.registrationBlocked, 'false');
  assert.equal(hint.hidden, true);
  submit({ preventDefault() { assert.fail('Corrected USN must reach authoritative server validation'); } });
});

async function fixture(student, run, identity = { usn: 'TEST001', name: 'Test Student' }) {
  const restores = [], updates = [];
  let rolledBack = false;
  const replace = (object, name, value) => { const previous = object[name]; object[name] = value; restores.push(() => { object[name] = previous; }); };
  const session = { session_id: 1, batch_id: 1, semester: '1', exam_session: 'Jun', exam_year: 2026, Batch: { batch_name: 'MCA 2025' } };
  const definition = { subject_id: 1, course_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 100, max_marks: 150 };
  const course = { ...definition, semester: '1', status: 'active', is_required: true, roster_verified: true };
  replace(db.ImportLog, 'findByPk', async () => ({ import_id: 9, file_name: 'test.pdf', file_type: 'pdf', ResultSession: session }));
  replace(db.ResultSession, 'findByPk', async () => session);
  replace(db.Batch, 'findByPk', async () => ({ batch_id: 1 }));
  const ocr = { extracted_json: { student: { ...identity }, attempt: { attempt_no: 1, exam_type: 'REGULAR' },
    subjects: [{ subject_id: 1, internalMarks: 42, externalMarks: 34 }] },
    update: async data => { updates.push(data); Object.assign(ocr, data); } };
  replace(db.OcrExtraction, 'findOne', async () => ocr);
  replace(db.Subject, 'findAll', async () => [definition]);
  replace(db.AcademicCourse, 'findAll', async () => [course]);
  replace(db.Student, 'findOne', async options => { assert.notEqual(options.paranoid, false); return student; });
  replace(db.Result, 'findOne', async () => null);
  replace(db.Result, 'findAll', async () => []);
  replace(outcomes, 'load', async () => ({ courses: [course], results: [], subjects: [] }));
  for (const [object, method] of [[db.Student, 'create'], [db.Student, 'update'], [db.Result, 'create'], [db.SubjectResult, 'bulkCreate']]) {
    replace(object, method, () => { assert.fail('No student or academic result may be written'); });
  }
  replace(db.sequelize, 'transaction', async () => ({ rollback: async () => { rolledBack = true; }, commit: async () => assert.fail('Must not commit a blocked import') }));
  const invoke = async (method, options = {}) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, render(view, locals) { this.view = view; this.locals = locals; }, redirect(url) { this.url = url; } };
    await controller[method]({ params: { importId: '9' }, query: {}, ...options, body: { usn: identity.usn.toLowerCase(), name: identity.name, internal_1: 42, external_1: 34, verify_usn: '1', verify_semester: '1', verify_period: '1', ...options.body } }, response);
    return response;
  };
  try { await run({ invoke, updates, ocr, isRolledBack: () => rolledBack }); }
  finally { restores.reverse().forEach(restore => restore()); }
}

for (const [name, student] of [['missing or deleted student', null], ['student registered in a different batch', { student_id: 1, batch_id: 2 }]]) {
  test(`${name}: initial extracted Review allows Validate without a registration alert`, async () => {
    await fixture(student, async ({ invoke }) => {
      const response = await invoke('showReviewPage');
      assert.equal(response.locals.formError, null);
      assert.equal(response.locals.registrationBlocked, false);
      const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), response.locals);
      assert.doesNotMatch(html, /id="resultValidationAlert"/);
      assert.doesNotMatch(html, /id="validateButton"[^>]*\sdisabled(?:\s|>)/);
    });
  });

  test(`${name}: validation stays on Review with an alert instead of opening preview`, async () => {
    await fixture(student, async ({ invoke, updates }) => {
      const response = await invoke('validateReview');
      assert.equal(response.statusCode, 422);
      assert.equal(response.view, 'results/review');
      assert.match(response.locals.formError, /TEST001 is not registered in MCA 2025/);
      assert.equal(response.locals.registrationBlocked, true);
      assert.equal(updates[0].validation_status, 'pending');
      assert.equal(response.locals.extractionWarning, null);
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
      const review = await invoke('showReviewPage', { query: { error: new URL(preview.url, 'http://localhost').searchParams.get('error') } });
      assert.match(review.locals.formError, /not registered in MCA 2025/);
      assert.equal(review.locals.registrationBlocked, true);
    });
  });
}

test('Validate displays the requested registration alert for the submitted OCR USN', async () => {
  await fixture(null, async ({ invoke }) => {
    const response = await invoke('validateReview', { body: { usn: '1IMV25MC074', name: 'Test Student', internal_1: 42, external_1: 34 } });
    assert.equal(response.statusCode, 422);
    assert.equal(response.locals.formError, 'Student 1IMV25MC074 is not registered in MCA 2025. Add or restore the student in this batch, or correct the USN and selected result session before continuing.');
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/review.ejs'), response.locals);
    assert.match(html, /<strong>Validation Failed<\/strong>/);
    assert.match(html, /Student 1IMV25MC074 is not registered in MCA 2025/);
  });
});

test('registered student in the selected batch can validate and preview with calculated CGPA', async () => {
  await fixture({ student_id: 1, batch_id: 1, student_name: 'TEST STUDENT' }, async ({ invoke, updates }) => {
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
