'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/models');
const controller = require('../controllers/resultController');
const migration = require('../migrations/20261002120000-subject-result-mark-components');

after(() => db.sequelize.close());

test('component migration adds nullable integers without backfilling totals', async () => {
  const columns = [];
  await migration.up({ describeTable: async () => ({ marks: {} }), addColumn: async (table, name, options) => columns.push({ table, name, options }) }, require('sequelize'));
  assert.deepEqual(columns.map(c => c.name), ['internal_marks', 'external_marks']);
  for (const column of columns) {
    assert.equal(column.table, 'subject_results');
    assert.equal(column.options.allowNull, true);
    assert.equal(column.options.defaultValue, null);
    assert.equal(column.options.type, require('sequelize').INTEGER);
  }
  assert.equal(db.SubjectResult.rawAttributes.internal_marks.allowNull, true);
  assert.equal(db.SubjectResult.rawAttributes.external_marks.allowNull, true);
  assert.equal(db.SubjectResult.rawAttributes.marks.allowNull, false);
});

test('confirmImport persists validated IA/External/Total while preserving academic and attempt rules', async t => {
  const restores = [];
  const replace = (object, name, value) => { const saved = object[name]; object[name] = value; restores.push(() => { object[name] = saved; }); };
  let subjectRows, header, committed, rolledBack, redirected, duplicate;
  const saved = { student: { usn: 'TESTUSN', name: 'Test Student' }, attempt: { attempt_no: 2, exam_type: 'BACKLOG' },
    subjects: [{ subject_id: 1, internalMarks: 42, externalMarks: 34, totalMarks: 999 }, { subject_id: 2, internalMarks: 0, externalMarks: 0 }] };
  replace(db.sequelize, 'transaction', async () => ({ commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; } }));
  replace(db.ImportLog, 'findByPk', async () => ({ import_id: 9, file_name: 'test.pdf', ResultSession: { session_id: 1, batch_id: 1, semester: '1', exam_session: 'Jan', exam_year: 2026, Batch: { batch_name: 'Test Batch' } }, update: async () => {} }));
  replace(db.OcrExtraction, 'findOne', async () => ({ extracted_json: JSON.stringify(saved) }));
  replace(db.Subject, 'findAll', async () => [1, 2].map(subject_id => ({ subject_id, subject_code: `S${subject_id}`, subject_name: `Subject ${subject_id}`, max_internal: 50, max_external: 100, max_marks: 150, credits: 4 })));
  replace(db.Student, 'findOne', async () => ({ student_id: 101 }));
  replace(db.Result, 'findOne', async () => duplicate ? { result_id: 99 } : null);
  replace(db.Result, 'create', async data => { header = data; return { result_id: 7 }; });
  replace(db.SubjectResult, 'bulkCreate', async data => { subjectRows = data; });
  const invoke = () => controller.confirmImport({ params: { importId: '9' }, body: { internal_1: 1, external_1: 1 } }, { redirect: url => { redirected = url; } });
  try {
    await t.test('new imports retain components, zero marks, validated total and original grade rules', async () => {
      await invoke();
      assert.deepEqual(subjectRows, [
        { result_id: 7, subject_id: 1, internal_marks: 42, external_marks: 34, marks: 76, grade: 'C', result_status: 'pass' },
        { result_id: 7, subject_id: 2, internal_marks: 0, external_marks: 0, marks: 0, grade: 'F', result_status: 'fail' }
      ]);
      assert.equal(header.attempt_no, 2); assert.equal(header.exam_type, 'BACKLOG');
      assert.equal(header.sgpa, 2.5); assert.equal(header.cgpa, 5); assert.equal(header.failed_subject_count, 1);
      assert.equal(header.result_status, 'fail'); assert.equal(committed, true);
      assert.match(redirected, /\/success$/);
    });
    await t.test('duplicate attempt still rolls back before inserting', async () => {
      subjectRows = undefined; header = undefined; committed = false; rolledBack = false; duplicate = true;
      await invoke();
      assert.equal(subjectRows, undefined); assert.equal(header, undefined); assert.equal(rolledBack, true); assert.equal(committed, false);
      assert.match(redirected, /Duplicate%20blocked/);
    });
    await t.test('invalid components still return to review without persistence', async () => {
      duplicate = false; rolledBack = false; saved.subjects[0].externalMarks = '';
      await invoke();
      assert.equal(subjectRows, undefined); assert.equal(header, undefined); assert.equal(rolledBack, true);
      assert.match(redirected, /\/review$/);
    });
  } finally { restores.reverse().forEach(restore => restore()); }
});
