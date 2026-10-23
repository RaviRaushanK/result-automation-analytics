'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ejs = require('ejs');

function fixture({ wrongScope = false, inactive = false, fail = false } = {}) {
  const calls = [], writes = [];
  const transaction = { commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback') };
  const models = {
    sequelize: { transaction: async () => { calls.push('begin'); return transaction; } },
    ExamSession: { findByPk: async () => ({ exam_session_id: 2, batch_id: wrongScope ? 99 : 1 }) },
    Subject: { findAll: async () => [{ subject_id: 3 }], findByPk: async () => ({ setFaculties: async (ids, opt) => { assert.equal(opt.transaction, transaction); if (fail) throw new Error('fixture write failure'); writes.push(ids); } }) },
    Faculty: { findAll: async query => { assert.equal(query.where.status, 'active'); const ids = query.where.faculty_id[require('sequelize').Op.in]; return inactive ? [] : ids.map(faculty_id => ({ faculty_id })); } }
  };
  const context = { module: { exports: {} }, console: { error() {} }, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/facultyController'), 'utf8'), context);
  return { calls, writes, async save(assignments) { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } }; await context.module.exports.saveAssignments({ body: { batch_id: 1, exam_session_id: 2, assignments } }, res); return res; } };
}

test('faculty assignment API saves more than two faculty in one transaction and retains legacy input support', async () => {
  const f = fixture();
  assert.equal((await f.save([{ subject_id: 3, faculty_ids: [1, 2, 3, 4] }])).code, 200);
  assert.deepEqual(Array.from(f.writes[0]), ['1', '2', '3', '4']);
  assert.deepEqual(f.calls, ['begin', 'commit']);
  assert.equal((await f.save([{ subject_id: 3, faculty_1: 1, faculty_2: 2 }])).code, 200);
});

test('duplicate faculty, malformed IDs and repeated subject rows fail before any transaction', async () => {
  for (const assignments of [
    [{ subject_id: 3, faculty_ids: [1, '1', 2] }], [{ subject_id: 3, faculty_ids: '1,2,3' }],
    [{ subject_id: 3, faculty_ids: [[1]] }], [{ subject_id: 3, faculty_ids: ['bad'] }],
    [{ subject_id: 3, faculty_1: 1, faculty_2: 1 }], [{ subject_id: [3], faculty_ids: [1] }],
    [{ subject_id: 3, faculty_ids: [1] }, { subject_id: 3, faculty_ids: [2] }]
  ]) { const f = fixture(); assert.equal((await f.save(assignments)).code, 400); assert.deepEqual(f.calls, []); }
});

test('batch mismatch, unavailable faculty and failed writes roll back without committing', async () => {
  for (const config of [{ wrongScope: true }, { inactive: true }, { fail: true }]) {
    const f = fixture(config), res = await f.save([{ subject_id: 3, faculty_ids: [1, 2, 3] }]);
    assert.ok(res.code >= 400); assert.deepEqual(f.calls, ['begin', 'rollback']);
  }
});

test('Edit Batch exposes calendar pickers for both duration years', async () => {
  const html = await ejs.renderFile(require.resolve('../views/batches/index.ejs'), { batches: [], departments: [] });
  for (const id of ['editBatchStartYear', 'editBatchEndYear']) { assert.ok(html.includes('aria-controls="' + id + 'Picker"')); assert.ok(html.includes('id="' + id + '" name="' + (id.endsWith('StartYear') ? 'start_year' : 'end_year') + '"')); }
});

test('Upload Results controller supplies newest cohort even when that batch has no sessions', async () => {
  const batches = [{ batch_id: 9, batch_name: 'Older', start_year: 2024, end_year: 2026 }, { batch_id: 1, batch_name: 'Newest', start_year: 2026, end_year: 2028 }];
  const models = { Batch: { findAll: async () => batches }, ExamSession: { findAll: async () => [{ exam_session_id: 7, batch_id: 9, Batch: batches[0], semester: '1', exam_session: 'Jan', exam_year: 2025 }] } };
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/resultController'), 'utf8'), context);
  let locals;
  await context.module.exports.showUploadPage({ query: {} }, { render: (view, data) => { locals = data; } });
  assert.equal(locals.selectedBatchId, 1); assert.equal(locals.sessions[0].batch_id, 9);
  const html = await ejs.renderFile(require.resolve('../views/results/upload.ejs'), locals);
  assert.match(html, /option value="1" selected/); assert.match(html, /data-batch-id="9"/);
});

test('Upload Results rejects batch/session mismatch before extraction or import writes', async () => {
  const removed = [];
  const models = { ExamSession: { findByPk: async () => ({ exam_session_id: 2, batch_id: 1 }) }, ImportLog: { create: async () => { throw new Error('No import write is allowed'); } } };
  const context = { module: { exports: {} }, console, require: name => name === '../database/models' ? models : name === 'fs' ? { unlinkSync: file => removed.push(file) } : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/resultController'), 'utf8'), context);
  let location;
  await context.module.exports.processUpload({ body: { exam_session_id: 2, batch_id: 99, attempt_no: 1, exam_type: 'REGULAR' }, file: { path: 'fixture-temp-file.pdf' } }, { redirect: url => { location = url; } });
  assert.match(decodeURIComponent(location), /belonging to the selected batch/);
  assert.deepEqual(removed, ['fixture-temp-file.pdf']);
});
