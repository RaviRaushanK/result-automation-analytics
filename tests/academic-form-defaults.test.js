'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const options = require('../public/js/academic-form-options');
const email = require('../public/js/faculty-email-validation');

test('latest batches use cohort years then ID, not alphabetic name or insertion date', () => {
  const batches = [{ batch_id: 90, start_year: 2024, end_year: 2026, batch_name: 'Z' }, { batch_id: 1, start_year: 2026, end_year: 2028, batch_name: 'A' }, { batch_id: 2, start_year: 2026, end_year: 2028, batch_name: 'B' }];
  assert.deepEqual(options.sortBatches(batches).map(batch => batch.batch_id), [2, 1, 90]);
  assert.equal(batches[0].batch_id, 90);
  assert.deepEqual(options.sortBatches([]), []);
});

test('semester count follows batch duration for two-year MCA and four-year BTech', () => {
  assert.equal(options.semesterCount({ start_year: 2025, end_year: 2027 }), 4);
  assert.equal(options.semesterCount({ start_year: '2025', end_year: '2029' }), 8);
  for (const batch of [undefined, {}, { start_year: 2025, end_year: 2025 }, { start_year: 2027, end_year: 2025 }, { start_year: 'invalid', end_year: 2027 }]) assert.equal(options.semesterCount(batch), 0);
});

test('session status is identical before/after saving and changes only with the examination month', () => {
  const now = new Date(2026, 9, 14);
  for (const [month, year, expected] of [['Sep', 2026, 'completed'], ['Oct', 2026, 'active'], ['November', 2026, 'upcoming'], ['JAN', 2027, 'upcoming'], ['Dec', 2025, 'completed']]) {
    const draft = { exam_session: month, exam_year: year };
    assert.equal(options.sessionStatus(draft, now), expected);
    assert.equal(options.sessionStatus({ ...draft, session_id: 1 }, now), expected);
  }
  assert.equal(options.sessionStatus({ exam_session: '', exam_year: 2026 }, now), '');
});

test('faculty email validation supports institutional mail, optional blank and matching browser/server rules', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/email-tlds.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/faculty-email-validation.js'), 'utf8'), context);
  for (const validator of [email, context.window.FacultyEmailValidation]) {
    for (const value of ['', 'faculty@college.edu', ' name+teaching@college.edu.in ', 'Teacher.Name@GMAIL.COM']) assert.equal(validator.getError(value), '', value);
    for (const value of ['bad', 'a@@b.com', 'a..b@college.edu', '.abc@college.edu', 'a@-college.edu', 'a@college..edu', 'name@college', 'a@college.c', 'name @college.edu', 'a'.repeat(91) + '@college.edu', 'teacher@gmail.clh', 'teacher@college.invalid']) assert.ok(validator.getError(value), value);
  }
});

function sessionFixture() {
  let batch = { batch_id: 1, start_year: 2025, end_year: 2027 };
  const writes = [];
  const models = { Batch: { findByPk: async () => batch }, ResultSession: { findOne: async () => null, create: async value => { writes.push(value); return value; } } };
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/sessionController.js'), 'utf8'), context);
  return {
    setBatch(value) { batch = value; }, writes,
    async create(body) { const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } }; await context.module.exports.create({ body }, res); return res; }
  };
}

test('session API enforces duration-specific semester choices without changing result calculations', async () => {
  const f = sessionFixture(), body = { batch_id: 1, semester: '4', exam_start_month: 7, exam_start_year: 2026 };
  assert.equal((await f.create(body)).statusCode, 201);
  assert.equal(f.writes[0].exam_session, 'Jul');
  assert.equal(f.writes[0].exam_end_month, 7);
  assert.equal((await f.create({ ...body, semester: '5' })).statusCode, 400);
  assert.equal(f.writes.length, 1);
  f.setBatch({ batch_id: 1, start_year: 2025, end_year: 2029 });
  assert.equal((await f.create({ ...body, semester: '8' })).statusCode, 201);
  assert.equal((await f.create({ ...body, semester: '9' })).statusCode, 400);
  f.setBatch({ batch_id: 1, start_year: 2025, end_year: 2025 });
  assert.equal((await f.create(body)).statusCode, 400);
});

test('faculty API shares email rules and rejects malformed email before saving', async () => {
  const writes = [];
  const models = { Faculty: { create: async value => { writes.push(value); return value; } }, Department: { findByPk: async () => ({ department_id: 1 }) } };
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/facultyController.js'), 'utf8'), context);
  async function create(value) { const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; await context.module.exports.create({ body: { department_id: 1, faculty_code: 'TEST', faculty_name: 'Test Faculty', email: value } }, res); return res; }
  assert.equal((await create('a@-college.edu')).statusCode, 400);
  assert.equal((await create('teacher@gmail.clh')).statusCode, 400);
  assert.equal(writes.length, 0);
  assert.equal((await create('teacher@college.edu')).statusCode, 201);
  assert.equal(writes[0].email, 'teacher@college.edu');
});
