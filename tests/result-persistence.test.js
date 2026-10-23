'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/models');
const controller = require('../controllers/resultController');
const migration = require('../migrations/20261002120000-subject-result-mark-components');

after(() => db.sequelize.close());

test('zero component limits accept zero marks and reject positive marks during result validation', async () => {
  const originalSubjects = db.Subject.findAll;
  const originalCourses = db.AcademicCourse.findAll;
  try {
    for (const zeroComponent of ['internal', 'external']) {
      const definition = { subject_id: 1, course_id: 1, subject_code: 'MAEC258',
        subject_name: 'ABILITY ENHANCEMENT COURSES WITH SEMINAR-I', subject_type: 'theory',
        credits: 0, max_internal: zeroComponent === 'internal' ? 0 : 100,
        max_external: zeroComponent === 'external' ? 0 : 100, max_marks: 100 };
      db.Subject.findAll = async () => [definition];
      db.AcademicCourse.findAll = async () => [{ ...definition, is_required: true, roster_verified: true }];
      const inputs = { internal_1: zeroComponent === 'internal' ? '0' : '98', external_1: zeroComponent === 'external' ? '0' : '98' };
      const validate = () => controller._test.buildValidatedPayload(1, { usn: 'TESTUSN', name: 'TEST STUDENT' }, inputs,
        { session: { batch_id: 1, semester: '2' }, exam_type: 'REGULAR' });
      const valid = await validate();
      assert.equal(valid.hasErrors, false);
      assert.equal(valid.payload.subjects[0]['max_' + zeroComponent], 0);
      assert.equal(valid.payload.subjects[0].totalMarks, 98);
      inputs[zeroComponent + '_1'] = '1';
      const invalid = await validate();
      assert.equal(invalid.hasErrors, true);
      assert.match(invalid.errors['subjects[1]'][zeroComponent + 'Marks'], /between 0 and 0/);
    }
  } finally {
    db.Subject.findAll = originalSubjects;
    db.AcademicCourse.findAll = originalCourses;
  }
});

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
  replace(db.ImportLog, 'findByPk', async () => ({ import_id: 9, file_name: 'test.pdf', ExamSession: { exam_session_id: 1, batch_id: 1, semester: '1', exam_session: 'Jan', exam_year: 2026, Batch: { batch_name: 'Test Batch' } }, update: async () => {} }));
  replace(db.ExamSession, 'findByPk', async () => ({ exam_session_id: 1, batch_id: 1, semester: '1', exam_session: 'Jan', exam_year: 2026 }));
  replace(db.Batch, 'findByPk', async () => ({ batch_id: 1 }));
  replace(db.OcrExtraction, 'findOne', async () => ({ validation_status: 'validated', extracted_json: JSON.stringify({ ...saved,
    document_context_verified: { usn: true, semester: true, period: true }, review_token: 'fixture-review', configuration_snapshot: require('../services/academicConfiguration').snapshot(
      { batch_id: 1, semester: '1', exam_session: 'Jan', exam_year: 2026 }, definitions, definitions.map(subject => ({ ...subject, is_required: true, roster_verified: true }))) }) }));
  const definitions = [1, 2].map(subject_id => ({ subject_id, course_id: subject_id, subject_code: `S${subject_id}`, subject_name: `Subject ${subject_id}`, max_internal: 50, max_external: 100, max_marks: 150, credits: 4 }));
  replace(db.Subject, 'findAll', async () => definitions);
  replace(db.AcademicCourse, 'findAll', async () => definitions.map(subject => ({ ...subject, is_required: true, roster_verified: true })));
  replace(require('../services/academicOutcomeService'), 'calculateCumulative', async () => null);
  replace(db.Student, 'findOne', async () => ({ student_id: 101, batch_id: 1, student_name: 'TEST STUDENT' }));
  replace(db.Result, 'findOne', async () => duplicate ? { result_id: 99 } : null);
  replace(db.Result, 'findAll', async () => [{ result_id: 6, exam_session_id: 1, attempt_no: 1, exam_type: 'REGULAR',
    ExamSession: { exam_session_id: 2, batch_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025 },
    SubjectResults: [1, 2].map(course_id_snapshot => ({ subject_result_id: course_id_snapshot, course_id_snapshot, result_status: 'fail' })) }]);
  replace(db.Result, 'create', async data => { header = data; return { result_id: 7 }; });
  replace(db.SubjectResult, 'bulkCreate', async data => { subjectRows = data; });
  const invoke = () => controller.confirmImport({ params: { importId: '9' }, body: { internal_1: 1, external_1: 1, review_token: 'fixture-review' } }, { redirect: url => { redirected = url; } });
  try {
    await t.test('new imports retain components, zero marks, validated total and original grade rules', async () => {
      await invoke();
      assert.deepEqual(subjectRows, [
        { result_id: 7, subject_id: 1, internal_marks: 42, external_marks: 34, marks: 76, grade: 'C', result_status: 'pass', grading_scheme_version: 'PG_2022_2024_V1', grade_point: 5, credits_snapshot: 4, course_id_snapshot: 1 },
        { result_id: 7, subject_id: 2, internal_marks: 0, external_marks: 0, marks: 0, grade: 'F', result_status: 'fail', grading_scheme_version: 'PG_2022_2024_V1', grade_point: 0, credits_snapshot: 4, course_id_snapshot: 2 }
      ]);
      assert.equal(header.attempt_no, 2); assert.equal(header.exam_type, 'BACKLOG');
      assert.equal(header.sgpa, null); assert.equal(header.cgpa, null); assert.equal(header.failed_subject_count, 1);
      assert.equal(header.cgpa_source, 'UNKNOWN'); assert.equal(header.cgpa_is_cumulative, false);
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
      assert.match(redirected, /\/review\?error=/);
    });
    await t.test('only a new verified regular header receives calculated cumulative provenance', async () => {
      saved.attempt.exam_type='REGULAR';saved.subjects[0].externalMarks=34;
      saved.attempt.attempt_no=1;
      replace(db.Result, 'findAll', async () => []);
      saved.subjects[1].internalMarks=42;saved.subjects[1].externalMarks=34;
      committed=false;rolledBack=false;
      replace(require('../services/academicOutcomeService'), 'calculateCumulative', async()=>5);
      replace(db.Result, 'create', async data=>{header=data;return{result_id:7,update:async values=>Object.assign(header,values)};});
      await invoke();
      assert.equal(committed,true);assert.equal(rolledBack,false);
      assert.equal(header.sgpa,5);assert.equal(header.cgpa,5);
      assert.equal(header.sgpa_source,'CALCULATED');assert.equal(header.cgpa_source,'CALCULATED');assert.equal(header.cgpa_is_cumulative,true);
      assert.equal(header.grading_scheme_version,'PG_2022_2024_V1');
    });
  } finally { restores.reverse().forEach(restore => restore()); }
});
