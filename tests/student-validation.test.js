const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx');
const { Sequelize, DataTypes } = require('sequelize');
const emailValidation = require('../public/js/student-email-validation');

const invalidEmails = [
  '', 'student', 'student@example', 'student@example.c', 'student@@example.com',
  'student..name@example.com', '.student@example.com', 'student.@example.com',
  'student@example..com', 'student@-example.com', 'student@example-.com',
  'student@exam_ple.com', 'student@example.com.', 'student@example.123',
  'student name@example.com', 'student@example.com,',
  'a'.repeat(65) + '@example.com', 'a@' + 'b'.repeat(64) + '.com',
  'a'.repeat(64) + '@' + 'b'.repeat(32) + '.com',
  'student_name@gmail.com', 'student-name@gmail.com', "o'connor@gmail.com",
  'student@gmial.com', 'student@gamil.com', 'student@gmai.com', 'student@gmail.con',
  'student@gmail.co', 'student@gmail.comm', 'student.@gmail.com', 'student.+tag@gmail.com',
  'sakldfklaf@gmdslal.com', 'student@example.com', 'student@college.edu.in',
  'student@googlemail.com', 'student@gmail.com.evil.com', 'student@sub.gmail.com'
];
const validEmails = ['student@gmail.com', 'student.name+admissions@gmail.com',
  'example@gmail.com', 'Student.Name123@GMAIL.COM'];
const validStudent = { batch_id: '1', usn: '1AB23CS001', student_name: 'Student Name',
  email: validEmails[0], category: 'PGCET', status: 'active' };

function controllerFixture(saveError) {
  const writes = [];
  const existing = { student_id: 1, update: async (value) => {
    if (saveError) throw saveError;
    writes.push(value);
  } };
  const models = {
    Student: {
      findOne: async () => null,
      findByPk: async () => existing,
      create: async (value) => {
        if (saveError) throw saveError;
        writes.push(value); return value;
      }
    },
    Batch: { findByPk: async () => ({ batch_id: 1, batch_name: '2026' }) }
  };
  const context = { module: { exports: {} }, console,
    require: (id) => id === '../database/models' ? models
      : id === '../public/js/student-email-validation' ? emailValidation : require(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/studentController.js'), 'utf8'), context);
  return { controller: context.module.exports, writes, models };
}

async function call(handler, req) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await handler(req, response);
  return response;
}

test('email rules reject malformed addresses and accept normal addresses in Node and browser', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/student-email-validation.js'), 'utf8'), browser);
  for (const validator of [emailValidation, browser.StudentEmailValidation]) {
    invalidEmails.forEach((email) => assert.equal(validator.isValid(email), false, email));
    validEmails.forEach((email) => assert.equal(validator.isValid(email), true, email));
  }
});

for (const action of ['create', 'update']) {
  test(action + ' blocks malformed emails before a database write', async () => {
    const { controller, writes } = controllerFixture();
    for (const email of invalidEmails) {
      const response = await call(controller[action], { params: { id: '1' }, body: { ...validStudent, email } });
      assert.equal(response.statusCode, 400, email);
      assert.match(response.body.message, /email/i);
    }
    assert.equal(writes.length, 0);
  });

  test(action + ' accepts a valid email and trims surrounding whitespace', async () => {
    const { controller, writes } = controllerFixture();
    const response = await call(controller[action], { params: { id: '1' },
      body: { ...validStudent, email: ' student.name+admissions@gmail.com ' } });
    assert.equal(response.body.success, true);
    assert.equal(writes[0].email, validEmails[1]);
  });
}

for (const bookType of ['csv', 'xlsx', 'biff8']) {
  test(bookType + ' preview identifies every invalid email without saving students', async () => {
    const { controller, writes } = controllerFixture();
    const workbook = XLSX.utils.book_new();
    const rows = [...invalidEmails, validEmails[0]].map((email, index) => ({
      USN: 'USN' + index, 'Student Name': 'Student Name', Email: email, Category: 'PGCET'
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Students');
    const response = await call(controller.importPreview, {
      body: { batch_id: '1', status: 'active' },
      file: { buffer: XLSX.write(workbook, { type: 'buffer', bookType }) }
    });
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.invalid, invalidEmails.length);
    assert.equal(response.body.data.valid, 1);
    response.body.data.rows.slice(0, -1).forEach((row) => assert.match(row.message, /email/i));
    assert.equal(writes.length, 0);
  });
}

test('import confirmation revalidates emails even when the client marks all rows valid', async () => {
  const { controller, writes } = controllerFixture();
  const response = await call(controller.importConfirm, { body: { batch_id: '1', status: 'inactive',
    rows: [...invalidEmails, validEmails[0]].map((email, index) => ({
      ...validStudent, usn: 'USN' + index, email, row: index + 1, valid: true
    })) } });
  assert.equal(response.body.data.imported, 1);
  assert.equal(response.body.data.skipped, invalidEmails.length);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].email, validEmails[0]);
  assert.equal(writes[0].status, 'inactive');
});

test('Student model validates emails without needing a database connection', async () => {
  const sequelize = new Sequelize('validation', 'test', 'test', { dialect: 'mysql', logging: false });
  const Student = require('../database/models/Student')(sequelize, DataTypes);
  try {
    for (const email of [...invalidEmails, null]) {
      await assert.rejects(Student.build({ ...validStudent,
        student_uuid: '00000000-0000-4000-8000-000000000001', email }).validate(), /email/i);
    }
    await Student.build({ ...validStudent, student_uuid: '00000000-0000-4000-8000-000000000001' }).validate();
  } finally { await sequelize.close(); }
});

test('email errors explain the particular mistake', () => {
  assert.match(emailValidation.getError('studentgmail.com'), /exactly one @/);
  assert.match(emailValidation.getError('student..name@gmail.com'), /consecutive dots/);
  assert.match(emailValidation.getError('student_name@gmail.com'), /invalid Gmail username/);
  assert.match(emailValidation.getError('student@gmial.com'), /Only @gmail.com/);
  assert.match(emailValidation.getError('student@gmail'), /Only @gmail.com/);
  assert.equal(emailValidation.getError('sakldfklaf@gmdslal.com'),
    'Only @gmail.com email addresses are allowed. Example: example@gmail.com.');
  assert.equal(emailValidation.getError('student.name@gmail.com'), '');
});

for (const action of ['create', 'update']) {
  test(action + ' exposes the underlying Sequelize field error', async () => {
    const error = { name: 'SequelizeValidationError', message: 'Validation error',
      errors: [{ path: 'email', message: 'Email must not contain spaces.' }] };
    const { controller } = controllerFixture(error);
    const response = await call(controller[action], { params: { id: '1' }, body: validStudent });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, 'Email: Email must not contain spaces.');
  });

  test(action + ' explains a duplicate even when it is detected during saving', async () => {
    const error = { name: 'SequelizeUniqueConstraintError', message: 'Validation error',
      errors: [{ path: 'email', message: 'email must be unique' }] };
    const { controller } = controllerFixture(error);
    const response = await call(controller[action], { params: { id: '1' }, body: validStudent });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /Email is already registered/);
  });
}

test('duplicate checks include deleted students that still occupy a unique key', async () => {
  const { controller, models, writes } = controllerFixture();
  models.Student.findOne = async (options) => {
    assert.equal(options.paranoid, false);
    return options.where.email ? { student_id: 20 } : null;
  };
  const response = await call(controller.create, { body: validStudent });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Duplicate Email/);
  assert.equal(writes.length, 0);
});

test('import results explain model errors for the affected row', async () => {
  const error = { name: 'SequelizeValidationError', message: 'Validation error',
    errors: [{ path: 'category', message: 'Category is required', type: 'notNull Violation' }] };
  const { controller } = controllerFixture(error);
  const response = await call(controller.importConfirm, { body: { batch_id: '1', status: 'active',
    rows: [{ ...validStudent, row: 1, valid: true }] } });
  assert.equal(response.body.data.imported, 0);
  assert.equal(response.body.data.skippedRows[0].reason, 'Category is required.');
});

test('browser preview rejects the reported address even if an API marks it valid', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(['d-none']);
      elements.set(id, { value: '', textContent: '', innerHTML: '', dataset: {}, files: [],
        handlers: {}, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name) },
        addEventListener(event, handler) { this.handlers[event] = handler; } });
    }
    return elements.get(id);
  }
  const document = { getElementById: element, querySelector: element,
    createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }),
    addEventListener(event, handler) { if (event === 'DOMContentLoaded') handler(); } };
  const browser = { document, URLSearchParams, StudentEmailValidation: emailValidation,
    bootstrap: { Modal: function () { this.show = () => {}; this.hide = () => {}; } },
    FormData: function () { this.append = () => {}; }, setTimeout, clearTimeout,
    fetch: async (url) => ({ ok: true, json: async () => url.includes('/import/preview')
      ? { data: { total: 1, valid: 1, invalid: 0, rows: [{ ...validStudent,
        email: 'sakldfklaf@gmdslal.com', row: 1, valid: true, message: 'Valid' }] } }
      : { data: url.includes('/stats') ? {} : [] } }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/students.js'), 'utf8'), browser);
  element('importBatch').value = '1';
  element('importStatus').value = 'active';
  element('importFile').files = [{}];
  await element('importParseBtn').handlers.click();
  assert.equal(element('importValid').textContent, 0);
  assert.equal(element('importInvalid').textContent, 1);
  assert.equal(element('importConfirmBtn').classList.contains('d-none'), true);
  assert.equal(element('importWarning').classList.contains('d-none'), false);
  assert.match(element('#importPreviewTable tbody').innerHTML, /Only @gmail.com email addresses are allowed/);
});

test('student list defaults to the latest batch and sorts by USN', async () => {
  const { controller, models } = controllerFixture();
  models.Batch.findOne = async (options) => {
    assert.equal(JSON.stringify(options.order), JSON.stringify([
      ['start_year', 'DESC'], ['end_year', 'DESC'], ['batch_id', 'DESC']
    ]));
    return { batch_id: 9 };
  };
  models.Student.findAll = async (options) => {
    assert.equal(options.where.batch_id, 9);
    assert.equal(JSON.stringify(options.order), JSON.stringify([['usn', 'ASC'], ['student_id', 'ASC']]));
    return [];
  };
  const response = await call(controller.list, { query: {} });
  assert.equal(response.body.success, true);
});

test('student stats use the selected batch and count categories', async () => {
  const { controller, models } = controllerFixture();
  models.Student.findAll = async (options) => {
    assert.equal(options.where.batch_id, '9');
    return [
      { category: 'PGCET', status: 'active' },
      { category: 'MGT', status: 'active' },
      { category: 'PGCET', status: 'inactive' }
    ];
  };
  const response = await call(controller.stats, { query: { batch_id: '9' } });
  assert.equal(JSON.stringify(response.body.data), JSON.stringify({ total: 3, active: 2, inactive: 1, categories: 2 }));
});

test('no batches produces an empty list and zero counts', async () => {
  const { controller, models } = controllerFixture();
  models.Batch.findOne = async () => null;
  models.Student.findAll = async () => { assert.fail('Students must not be queried across all batches'); };
  const list = await call(controller.list, { query: {} });
  assert.equal(list.body.data.length, 0);
  const stats = await call(controller.stats, { query: {} });
  assert.equal(stats.body.data.total, 0);
  assert.equal(stats.body.data.categories, 0);
});

test('Students template selects the first batch, removes category cards and shows serial numbers', () => {
  const ejs = require('ejs');
  const html = ejs.render(fs.readFileSync(path.join(__dirname, '../views/students/index.ejs'), 'utf8'), {
    batches: [{ batch_id: 9, batch_name: '2026-2028' }, { batch_id: 1, batch_name: '2024-2026' }],
    categories: [], initialSearch: ''
  });
  const batchFilter = html.match(/<select id="filterBatch"[\s\S]*?<\/select>/)[0];
  assert.match(batchFilter, /value="9" selected/);
  assert.doesNotMatch(batchFilter, />All</);
  assert.match(html, /SL No\./);
  assert.match(html, /Categories/);
  assert.doesNotMatch(html, /Emails to Review/);
  assert.doesNotMatch(html, /statPgcet|statMgt|PGCET Students|MGT Students/);
});
