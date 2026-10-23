'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(failure) {
  const saved = [], logged = [];
  const models = {
    Department: { findByPk: async () => ({ department_id: 1 }) },
    Faculty: { create: async data => { if (failure) throw failure; saved.push(data); return data; } },
  };
  const context = {
    module: { exports: {} },
    console: { error: (...args) => logged.push(args) },
    require: name => name === '../database/models' ? models : require(name),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/facultyController'), 'utf8'), context);
  return {
    saved, logged,
    async create(extra = {}) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await context.module.exports.create({ body: { department_id: 1, faculty_code: '1001', faculty_name: 'Test Faculty', ...extra } }, res);
      return res;
    },
  };
}

test('duplicate faculty code without email reports only the code conflict without an error stack', async () => {
  for (const details of [{ fields: { faculty_code: '1001' } }, { errors: [{ path: 'faculty_code' }] }]) {
    const f = fixture({ name: 'SequelizeUniqueConstraintError', ...details });
    const res = await f.create();
    assert.equal(res.code, 409);
    assert.match(res.body.message, /faculty code already exists/);
    assert.doesNotMatch(res.body.message, /email/i);
    assert.equal(f.saved.length, 0);
    assert.equal(f.logged.length, 0);
  }
});

test('optional email uniqueness reports the email conflict specifically', async () => {
  const f = fixture({ name: 'SequelizeUniqueConstraintError', errors: [{ path: 'email' }] });
  const res = await f.create({ email: 'test@example.edu' });
  assert.equal(res.code, 409);
  assert.match(res.body.message, /faculty email already exists/);
  assert.doesNotMatch(res.body.message, /faculty code/i);
  assert.equal(f.logged.length, 0);
});

test('unidentified unique conflicts do not claim an email conflict', async () => {
  const f = fixture({ name: 'SequelizeUniqueConstraintError', fields: { faculty_uuid: 'fixture' } });
  const res = await f.create();
  assert.equal(res.code, 409);
  assert.match(res.body.message, /record with these details already exists/);
  assert.doesNotMatch(res.body.message, /email/i);
});

test('faculty creation permits missing email and stores it as null', async () => {
  const f = fixture();
  assert.equal((await f.create()).code, 201);
  assert.equal(f.saved[0].email, null);
});

test('unexpected faculty creation failures still return 500 and are logged', async () => {
  const f = fixture(new Error('fixture database failure'));
  const res = await f.create();
  assert.equal(res.code, 500);
  assert.equal(f.logged.length, 1);
  assert.doesNotMatch(res.body.message, /fixture database failure/);
});
