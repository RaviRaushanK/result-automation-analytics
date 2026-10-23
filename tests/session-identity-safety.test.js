'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(resultCount = 1, subjectCount = 0) {
  const session = { session_id: 1, batch_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025 };
  const transaction = {}, writes = [], reads = [];
  let committed = false;
  const models = {
    sequelize: { transaction: async run => { const result = await run(transaction); committed = true; return result; } },
    ResultSession: {
      findByPk: async (id, options) => { reads.push(options); assert.equal(options.transaction, transaction); return session; },
      findOne: async () => null,
      update: async (data, options) => { assert.equal(options.transaction, transaction); writes.push(data); }
    },
    Result: { count: async options => { assert.equal(options.where.session_id, 1); assert.equal(options.transaction, transaction); return resultCount; } },
    Subject: { count: async () => subjectCount },
    Batch: { findByPk: async () => ({ start_year: 2025, end_year: 2027 }) }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/sessionController'), 'utf8'), {
    module, console, require: name => name === '../database/models' ? models : require(name)
  });
  return { writes, reads, async invoke(changes) {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { assert.equal(committed, true); this.body = body; } };
    await module.exports.update({ params: { id: 1 }, body: { semester: '1', exam_session: 'Dec', exam_year: 2025, ...changes } }, res);
    assert.equal(reads[0].lock, true);
    return res;
  } };
}

for (const changes of [{ semester: '2' }, { exam_session: 'Jun' }, { exam_year: 2026 }, { batch_id: 2 }]) {
  test(`sessions with saved results reject identity changes: ${JSON.stringify(changes)}`, async () => {
    const f = fixture(); const res = await f.invoke(changes);
    assert.equal(res.statusCode, 409); assert.equal(f.writes.length, 0);
    assert.match(res.body.message, /new examination session/);
  });
}
test('a semantic no-op using normalized month/semester is allowed with saved results', async () => {
  const f = fixture(); assert.equal((await f.invoke({ semester: '01', exam_session: 'December', batch_id: 1 })).statusCode, 200);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].exam_session, 'Dec');
});
test('a month/year correction remains allowed before results exist', async () => {
  const f = fixture(0, 1); assert.equal((await f.invoke({ exam_session: 'Jun', exam_year: 2026 })).statusCode, 200);
  assert.equal(f.writes[0].exam_session, 'Jun');
});
test('configured courses still prevent changing the academic semester without saved results', async () => {
  const f = fixture(0, 1); assert.equal((await f.invoke({ semester: '2' })).statusCode, 409);
  assert.equal(f.writes.length, 0);
});
