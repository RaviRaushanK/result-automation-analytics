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
  const existing = { ...validStudent, student_id: 1, update: async (value) => {
    if (saveError) throw saveError;
    writes.push(value);
  } };
  const models = {
    sequelize: { transaction: callback => callback({ LOCK: { UPDATE: 'UPDATE' } }) },
    Result: { findOne: async () => null },
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
  function load(relative, dependencies) {
    const sandbox = { module: { exports: {} }, console, URLSearchParams,
      require: id => dependencies[id] || require(id) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, relative), 'utf8'), sandbox);
    return sandbox.module.exports;
  }
  const repository = load('../repositories/studentDirectoryRepository.js', { '../database/models': models });
  const directory = load('../services/studentDirectoryService.js', { '../repositories/studentDirectoryRepository': repository });
  const context = { module: { exports: {} }, console, URLSearchParams,
    require: (id) => id === '../database/models' ? models
      : id === '../services/studentDirectoryService' ? directory
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

test('Student model normalizes USNs at the write boundary for builds and updates', async () => {
  const sequelize = new Sequelize('validation', 'test', 'test', { dialect: 'mysql', logging: false });
  const Student = require('../database/models/Student')(sequelize, DataTypes);
  try {
    const student = Student.build({ ...validStudent, usn: ' 1mv25mc061 ' });
    assert.equal(student.getDataValue('usn'), '1MV25MC061');
    student.set('usn', ' 1mV25mC062 ');
    assert.equal(student.getDataValue('usn'), '1MV25MC062');
  } finally { await sequelize.close(); }
});

test('Student model stores lowercase emails for builds and updates', async () => {
  const sequelize = new Sequelize('validation', 'test', 'test', { dialect: 'mysql', logging: false });
  const Student = require('../database/models/Student')(sequelize, DataTypes);
  try {
    const student = Student.build({ ...validStudent, email: ' RAVIRAUSHAN@GMAIL.COM ' });
    assert.equal(student.getDataValue('email'), 'raviraushan@gmail.com');
    student.set('email', ' STUDENT.NAME+TAG@GMAIL.COM ');
    assert.equal(student.getDataValue('email'), 'student.name+tag@gmail.com');
  } finally { await sequelize.close(); }
});

test('Student model stores uppercase names for builds and updates while retaining punctuation', async () => {
  const sequelize = new Sequelize('validation', 'test', 'test', { dialect: 'mysql', logging: false });
  const Student = require('../database/models/Student')(sequelize, DataTypes);
  try {
    const student = Student.build({ ...validStudent, student_name: ' ravi raushan kumar ' });
    assert.equal(student.getDataValue('student_name'), 'RAVI RAUSHAN KUMAR');
    student.set('student_name', " mary-jane o'connor ");
    assert.equal(student.getDataValue('student_name'), "MARY-JANE O'CONNOR");
  } finally { await sequelize.close(); }
});

test('Add and Edit Student persist uppercase names from lowercase and mixed-case input', async () => {
  for (const action of ['create', 'update']) {
    const f = controllerFixture();
    const response = await call(f.controller[action], { params: { id: '1' }, body: { ...validStudent, student_name: ' ravi Raushan kumar ' } });
    assert.ok(response.statusCode < 300);
    assert.equal(f.writes[0].student_name, 'RAVI RAUSHAN KUMAR');
  }
});

test('import preview and confirmation normalize names to uppercase', async () => {
  const f = controllerFixture();
  const csv = 'USN,Student Name,Email,Category\n1MV25MC061,ravi raushan kumar,student@gmail.com,PGCET';
  const preview = await call(f.controller.importPreview, {
    body: { batch_id: '1', status: 'active' }, file: { buffer: Buffer.from(csv) }
  });
  assert.equal(preview.body.data.rows[0].student_name, 'RAVI RAUSHAN KUMAR');
  const response = await importDeleted(f.controller, { student_name: 'ravi raushan kumar' });
  assert.equal(response.body.data.imported, 1);
  assert.equal(f.writes[0].student_name, 'RAVI RAUSHAN KUMAR');
});

test('name migration normalizes stored names without touching student identities or deletion state', async () => {
  const migration = require('../migrations/20261015140000-normalize-student-names');
  const transaction = {}, calls = [];
  await migration.up({ sequelize: { transaction: callback => callback(transaction), query: async (sql, options) => {
    assert.equal(options.transaction, transaction); calls.push(sql);
  } } });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /SET student_name = UPPER\(TRIM\(student_name\)\)/);
  assert.doesNotMatch(calls[0], /student_id|student_uuid|deleted_at/);
});

test('Add and Edit Student lowercase emails before duplicate lookup and persistence', async () => {
  for (const action of ['create', 'update']) {
    const f = controllerFixture();
    f.models.Student.findOne = async options => {
      if (options.where.email) assert.equal(options.where.email, 'raviraushan@gmail.com');
      return null;
    };
    const response = await call(f.controller[action], { params: { id: '1' }, body: { ...validStudent, email: ' RAVIRAUSHAN@GMAIL.COM ' } });
    assert.ok(response.statusCode < 300);
    assert.equal(f.writes[0].email, 'raviraushan@gmail.com');
  }
});

test('import preview and confirmation lowercase emails', async () => {
  const f = controllerFixture();
  const csv = 'USN,Student Name,Email,Category\n1MV25MC061,Student Name,RAVIRAUSHAN@GMAIL.COM,PGCET';
  const preview = await call(f.controller.importPreview, {
    body: { batch_id: '1', status: 'active' }, file: { buffer: Buffer.from(csv) }
  });
  assert.equal(preview.body.data.rows[0].email, 'raviraushan@gmail.com');
  const response = await importDeleted(f.controller, { email: ' RAVIRAUSHAN@GMAIL.COM ' });
  assert.equal(response.body.data.imported, 1);
  assert.equal(f.writes[0].email, 'raviraushan@gmail.com');
});

test('email migration checks collisions before normalizing active and deleted rows', async () => {
  const migration = require('../migrations/20261015130000-normalize-student-emails');
  for (const conflicts of [[], [{ normalized_email: 'duplicate@gmail.com' }]]) {
    const calls = [], transaction = {};
    const queryInterface = { sequelize: { transaction: callback => callback(transaction),
      query: async (sql, options) => { assert.equal(options.transaction, transaction); calls.push(sql); return [conflicts]; } } };
    if (conflicts.length) await assert.rejects(migration.up(queryInterface), /duplicate normalized/);
    else await migration.up(queryInterface);
    assert.equal(calls.length, conflicts.length ? 1 : 2);
    if (!conflicts.length) {
      assert.match(calls[1], /SET email = LOWER\(TRIM\(email\)\)/);
      assert.doesNotMatch(calls[1], /deleted_at|student_id|student_uuid/);
    }
  }
});

test('Add and Edit Student normalize USNs before duplicate lookup and persistence', async () => {
  for (const action of ['create', 'update']) {
    const f = controllerFixture();
    f.models.Student.findOne = async options => {
      if (options.where.usn) assert.equal(options.where.usn, '1MV25MC061');
      return null;
    };
    const response = await call(f.controller[action], { params: { id: '1' }, body: { ...validStudent, usn: ' 1mv25mc061 ' } });
    assert.ok(response.statusCode < 300);
    assert.equal(f.writes[0].usn, '1MV25MC061');
  }
});

test('import preview and confirmation normalize lowercase USNs', async () => {
  const f = controllerFixture();
  const csv = 'USN,Student Name,Email,Category\n1mv25mc061,Student Name,student@gmail.com,PGCET';
  const preview = await call(f.controller.importPreview, {
    body: { batch_id: '1', status: 'active' }, file: { buffer: Buffer.from(csv) }
  });
  assert.equal(preview.body.data.rows[0].usn, '1MV25MC061');
  const result = await importDeleted(f.controller, { usn: ' 1mv25mc061 ' });
  assert.equal(result.body.data.imported, 1);
  assert.equal(f.writes[0].usn, '1MV25MC061');
});

test('USN migration checks collisions before normalizing active and deleted rows', async () => {
  const migration = require('../migrations/20261015120000-normalize-student-usns');
  for (const conflicts of [[], [{ normalized_usn: 'DUPLICATE' }]]) {
    const calls = [], transaction = {};
    const queryInterface = { sequelize: { transaction: callback => callback(transaction),
      query: async (sql, options) => { assert.equal(options.transaction, transaction); calls.push(sql); return [conflicts]; } } };
    if (conflicts.length) await assert.rejects(migration.up(queryInterface), /duplicate normalized/);
    else await migration.up(queryInterface);
    assert.equal(calls.length, conflicts.length ? 1 : 2);
    assert.match(calls[0], /HAVING COUNT\(\*\) > 1/);
    if (!conflicts.length) {
      assert.match(calls[1], /SET usn = UPPER\(TRIM\(usn\)\)/);
      assert.doesNotMatch(calls[1], /deleted_at|student_id|student_uuid/);
    }
  }
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

function deletedStudentFixture({ batch = 1, active = false, emailConflict = false, failRestore = false, changed = false } = {}) {
  const f = controllerFixture();
  const original = { ...validStudent, student_id: 42, student_uuid: 'original-uuid', batch_id: batch,
    deleted_at: active ? null : new Date('2026-01-01') };
  const record = { ...original };
  const events = [];
  f.models.Student.findOne = async options => {
    assert.equal(options.paranoid, false);
    if (options.where.usn) return record;
    if (options.where.email) return emailConflict ? { student_id: 99 } : record;
    return null;
  };
  f.models.Student.findByPk = async (id, options) => {
    assert.equal(id, 42); assert.equal(options.paranoid, false);
    assert.equal(options.lock, 'UPDATE');
    if (changed) record.deleted_at = null;
    return record;
  };
  record.update = async (values, options) => { assert.ok(options.transaction); Object.assign(record, values); events.push('update'); };
  record.restore = async options => {
    assert.ok(options.transaction);
    if (failRestore) throw new Error('restore failed');
    record.deleted_at = null; events.push('restore');
  };
  f.models.sequelize.transaction = async callback => {
    events.push('begin');
    try { const result = await callback({ LOCK: { UPDATE: 'UPDATE' } }); events.push('commit'); return result; }
    catch (e) { Object.assign(record, original); events.push('rollback'); throw e; }
  };
  return { ...f, record, events };
}

function importDeleted(controller, overrides = {}) {
  return call(controller.importConfirm, { body: { batch_id: '1', status: 'active',
    rows: [{ ...validStudent, row: 1, valid: true, ...overrides }] } });
}

test('Add Student restores an eligible deleted student with original identity and submitted details', async () => {
  const f = deletedStudentFixture();
  const response = await call(f.controller.create, { body: { ...validStudent, student_name: 'Updated Name', status: 'inactive' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.restored, true);
  assert.equal(response.body.message, 'Student restored successfully');
  assert.equal(response.body.data.student_id, 42);
  assert.equal(response.body.data.student_uuid, 'original-uuid');
  assert.equal(f.record.deleted_at, null);
  assert.equal(f.record.student_name, 'UPDATED NAME');
  assert.equal(f.record.status, 'inactive');
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.events, ['begin', 'update', 'restore', 'commit']);
});

test('Add Student still rejects active duplicates, different batches, and conflicting emails', async () => {
  for (const options of [{ active: true }, { batch: 2 }, { emailConflict: true }]) {
    const f = deletedStudentFixture(options);
    const response = await call(f.controller.create, { body: validStudent });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /Duplicate/);
    assert.deepEqual(f.events, []);
    assert.equal(f.writes.length, 0);
  }
});

test('Add Student rolls back failed restoration and reports concurrent changes without overwriting', async () => {
  for (const options of [{ failRestore: true }, { changed: true }]) {
    const f = deletedStudentFixture(options);
    const response = await call(f.controller.create, { body: { ...validStudent, student_name: 'Updated Name' } });
    assert.equal(response.statusCode, options.changed ? 409 : 500);
    assert.equal(f.record.student_name, validStudent.student_name);
    assert.ok(f.record.deleted_at);
    assert.equal(f.events.at(-1), 'rollback');
    if (options.changed) assert.match(response.body.message, /record changed/);
  }
});

test('import preview accepts a deleted student in the same batch and explains restoration without writes', async () => {
  const f = deletedStudentFixture();
  const csv = 'USN,Student Name,Email,Category\n' + [validStudent.usn, validStudent.student_name, validStudent.email, 'PGCET'].join(',');
  const response = await call(f.controller.importPreview, {
    body: { batch_id: '1', status: 'active' }, file: { buffer: Buffer.from(csv) }
  });
  assert.equal(response.body.data.valid, 1);
  assert.match(response.body.data.rows[0].message, /restore deleted student/);
  assert.ok(f.record.deleted_at);
  assert.deepEqual(f.events, []);
  assert.equal(f.writes.length, 0);
});

test('re-import restores original student ID and UUID, updates details, and preserves result ownership', async () => {
  const f = deletedStudentFixture();
  const savedResult = { student_id: 42, marks: 87 };
  const response = await importDeleted(f.controller, { student_name: 'Updated Name', category: 'MGT' });
  assert.equal(response.body.data.imported, 1);
  assert.equal(response.body.data.restored, 1);
  assert.equal(response.body.data.skipped, 0);
  assert.equal(f.record.deleted_at, null);
  assert.equal(f.record.student_id, savedResult.student_id);
  assert.equal(f.record.student_uuid, 'original-uuid');
  assert.equal(f.record.student_name, 'UPDATED NAME');
  assert.equal(f.record.category, 'MGT');
  assert.equal(f.record.status, 'active');
  assert.equal(savedResult.marks, 87);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.events, ['begin', 'update', 'restore', 'commit']);
  const again = await importDeleted(f.controller);
  assert.equal(again.body.data.imported, 0);
  assert.match(again.body.data.skippedRows[0].reason, /Duplicate USN/);
});

test('restoration rejects active duplicates, different batches and email conflicts without writes', async () => {
  for (const options of [{ active: true }, { batch: 2 }, { emailConflict: true }]) {
    const f = deletedStudentFixture(options);
    const response = await importDeleted(f.controller);
    assert.equal(response.body.data.imported, 0);
    assert.equal(response.body.data.skipped, 1);
    assert.match(response.body.data.skippedRows[0].reason, /Duplicate/);
    assert.deepEqual(f.events, []);
  }
});

test('failed restoration rolls back detail updates and leaves the original deleted record intact', async () => {
  const f = deletedStudentFixture({ failRestore: true });
  const response = await importDeleted(f.controller, { student_name: 'Updated Name' });
  assert.equal(response.body.data.imported, 0);
  assert.ok(f.record.deleted_at);
  assert.equal(f.record.student_name, validStudent.student_name);
  assert.deepEqual(f.events, ['begin', 'update', 'rollback']);
});

test('concurrently restored students are not overwritten by an older import preview', async () => {
  const f = deletedStudentFixture({ changed: true });
  const response = await importDeleted(f.controller);
  assert.equal(response.body.data.imported, 0);
  assert.match(response.body.data.skippedRows[0].reason, /record changed/);
  assert.deepEqual(f.events, ['begin', 'rollback']);
});

test('stale restoration cannot rewrite a student whose USN changed after preview', async () => {
  const f = deletedStudentFixture();
  const findByPk = f.models.Student.findByPk;
  f.models.Student.findByPk = async (...args) => {
    const record = await findByPk(...args);
    record.usn = 'ANOTHER001';
    return record;
  };
  const response = await importDeleted(f.controller);
  assert.equal(response.body.data.imported, 0);
  assert.match(response.body.data.skippedRows[0].reason, /record changed/);
  assert.deepEqual(f.events, ['begin', 'rollback']);
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
        setAttribute() {},
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
    AbortController, location: { pathname: '/students', search: '' }, history: { replaceState() {}, pushState() {} }, window: { addEventListener() {} },
    bootstrap: { Modal: function () { this.show = () => {}; this.hide = () => {}; } },
    FormData: function () { this.append = () => {}; }, setTimeout, clearTimeout,
    fetch: async (url) => ({ ok: true, json: async () => url.includes('/import/preview')
      ? { data: { total: 1, valid: 1, invalid: 0, rows: [{ ...validStudent,
        email: 'sakldfklaf@gmdslal.com', row: 1, valid: true, message: 'Valid' }] } }
      : { data: url.includes('/stats') ? {} : [] } }) };
  element('studentListing').dataset = { defaultBatch: '1', pagination: JSON.stringify({ page: 1, pageSize: 25, totalRows: 0, totalPages: 0 }) };
  element('studentPageSize').value = '25';
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
    assert.equal(options.where.batch_id, '9');
    assert.equal(JSON.stringify(options.order), JSON.stringify([['usn', 'ASC'], ['student_id', 'ASC']]));
    return [];
  };
  models.Student.count = async () => 1;
  const response = await call(controller.list, { query: {} });
  assert.equal(response.body.success, true);
});

test('student stats use the selected batch and count categories', async () => {
  const { controller, models } = controllerFixture();
  models.Student.count = async (options) => {
    assert.equal(options.where.batch_id, '9');
    return options.distinct ? 2 : options.where.status === 'active' ? 2 : options.where.status === 'inactive' ? 1 : 3;
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
    categories: [], listing: { rows: [], filters: { search: '', batch_id: '9', category: '', status: '' }, pagination: { page: 1, pageSize: 25, totalRows: 0, totalPages: 0 } }, initialError: ''
  }, { filename: path.join(__dirname, '../views/students/index.ejs') });
  const batchFilter = html.match(/<select id="filterBatch"[\s\S]*?<\/select>/)[0];
  assert.match(batchFilter, /value="9" selected/);
  assert.match(batchFilter, />All Batches</);
  assert.match(html, /SL No\./);
  assert.match(html, /Categories/);
  assert.doesNotMatch(html, /Emails to Review/);
  assert.doesNotMatch(html, /statPgcet|statMgt|PGCET Students|MGT Students/);
});
