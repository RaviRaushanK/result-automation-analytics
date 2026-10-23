'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ subjects = 0, results = 0, imports = 0, exists = true } = {}) {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const state = { destroyed: 0, locked: false };
  const session = exists ? { exam_session_id: 7 } : null;
  const models = {
    sequelize: { transaction: async callback => callback(transaction) },
    ExamSession: {
      findByPk: async (id, options) => {
        assert.equal(String(id), '7');
        assert.equal(options.transaction, transaction);
        assert.equal(options.lock, true);
        state.locked = true;
        return session;
      },
      destroy: async options => {
        assert.equal(state.locked, true);
        assert.equal(options.where.exam_session_id, 7);
        assert.equal(Object.keys(options.where).length, 1);
        assert.equal(options.transaction, transaction);
        state.destroyed++;
      }
    },
    Subject: { count: async options => { assert.equal(options.transaction, transaction); return subjects; } },
    Result: { count: async options => { assert.equal(options.transaction, transaction); return results; } },
    ImportLog: { count: async options => { assert.equal(options.transaction, transaction); return imports; } },
    Batch: {}, Department: {}
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/examSessionController'), 'utf8'), {
    module, console, require: name => name === '../database/models' ? models : require(name)
  });
  return { state, async invoke() {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports.delete({ params: { id: 7 } }, response);
    return response;
  } };
}

test('a completely unused examination session can be deleted transactionally', async () => {
  const f = fixture();
  const response = await f.invoke();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(f.state.destroyed, 1);
});

for (const [label, dependencies] of [
  ['configured subjects', { subjects: 2 }],
  ['saved results', { results: 1 }],
  ['upload/import history', { imports: 3 }],
  ['mixed dependencies', { subjects: 1, results: 2, imports: 1 }]
]) {
  test(`session deletion is blocked by ${label}`, async () => {
    const f = fixture(dependencies);
    const response = await f.invoke();
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /Only a completely unused session can be deleted/);
    assert.equal(f.state.destroyed, 0);
  });
}

test('deleting an unknown session returns 404 without a destroy', async () => {
  const f = fixture({ exists: false });
  const response = await f.invoke();
  assert.equal(response.statusCode, 404);
  assert.equal(f.state.destroyed, 0);
});
