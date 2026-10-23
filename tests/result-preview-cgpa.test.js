'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const db = require('../database/models');
const outcomes = require('../services/academicOutcomeService');
const policy = require('../services/academicPolicy');
const controller = require('../controllers/resultController');
after(() => db.sequelize.close());
const attempt = { attempt_no: 1, exam_type: 'REGULAR' };
const session = { session_id: 2, batch_id: 1, semester: '2', exam_session: 'Jun', exam_year: 2026 };
function fixture() {
  const courses = [1, 2].map(n => ({ course_id: n, semester: String(n), subject_code: 'C' + n, credits: n === 1 ? 4 : 2, status: 'active', is_required: true, roster_verified: true }));
  const first = { result_id: 1, student_id: 1, session_id: 1, semester: '1', exam_session: 'Dec', exam_year: 2025, ...attempt };
  return { courses, results: [first], subjects: [{ ...first, course_id_snapshot: 1, credits_snapshot: 4, grade: 'A', grade_point: 8, grading_scheme_version: policy.SCHEME, outcome_status: 'pass' }] };
}
const pending = (grade = 'C') => [{ subject_id: 2, course_id: 2, credits: 2, grade, grade_point: policy.POINTS[grade], grading_scheme_version: policy.SCHEME, result_status: grade === 'F' ? 'fail' : 'pass' }];

test('preview calculates credit-weighted cumulative CGPA with pending marks without mutating history', () => {
  const data = fixture(), before = JSON.stringify(data);
  assert.equal(outcomes.previewCumulative(data, 1, session, attempt, pending()), 7);
  assert.equal(outcomes.previewCumulative(data, 1, session, attempt, pending('F')), 5.33);
  assert.equal(JSON.stringify(data), before);
});

test('first-semester preview supports new students and retains zero GPA', () => {
  const data = { ...fixture(), results: [], subjects: [] };
  const subjects = [{ ...pending('F')[0], subject_id: 1, course_id: 1, credits: 4 }];
  assert.equal(outcomes.previewCumulative(data, 'preview-student', { ...session, session_id: 1, semester: '1' }, attempt, subjects), 0);
});

test('incomplete or legacy history, invalid dates and duplicate attempts never fabricate CGPA', () => {
  for (const mutate of [data => { data.subjects = []; }, data => { data.courses[0].roster_verified = false; },
    data => { data.subjects[0].grading_scheme_version = null; },
    data => { data.results.push({ ...session, ...attempt, result_id: 2, student_id: 1 }); }]) {
    const data = fixture(); mutate(data);
    assert.equal(outcomes.previewCumulative(data, 1, session, attempt, pending()), null);
  }
  assert.equal(outcomes.previewCumulative(fixture(), 1, { ...session, exam_session: 'Unknown' }, attempt, pending()), null);
});

test('partial retake preview uses earlier course history rather than treating the retake as a whole semester', () => {
  const data = fixture();
  data.subjects[0] = { ...data.subjects[0], grade: 'F', grade_point: 0, outcome_status: 'fail' };
  const subjects = [{ ...pending('A')[0], course_id: 1, credits: 4 }];
  assert.equal(outcomes.previewCumulative(data, 1, { ...session, semester: '1' }, { ...attempt, exam_type: 'BACKLOG' }, subjects), 8);
});

test('preview does not use future retakes to improve an earlier cumulative snapshot', () => {
  const data = fixture();
  data.subjects[0] = { ...data.subjects[0], grade: 'F', grade_point: 0, outcome_status: 'fail' };
  const future = { ...data.results[0], result_id: 3, session_id: 3, exam_year: 2027, exam_type: 'BACKLOG' };
  data.results.push(future); data.subjects.push({ ...data.subjects[0], ...future, grade: 'O', grade_point: 10, outcome_status: 'pass' });
  assert.equal(outcomes.previewCumulative(data, 1, session, attempt, pending()), 1.67);
});

test('preview controller renders calculated CGPA without starting transactions or writing records', async () => {
  const restores = [];
  const replace = (object, name, value) => { const saved = object[name]; object[name] = value; restores.push(() => { object[name] = saved; }); };
  const current = { ...session, semester: '1', Batch: { batch_name: 'MCA 2025' } };
  const definition = { subject_id: 1, course_id: 1, subject_code: 'C1', subject_name: 'Course', credits: 4, max_internal: 50, max_external: 100, max_marks: 150 };
  const course = { ...definition, semester: '1', status: 'active', is_required: true, roster_verified: true };
  replace(db.ImportLog, 'findByPk', async () => ({ import_id: 9, file_name: 'test.pdf', ResultSession: current }));
  replace(db.OcrExtraction, 'findOne', async () => ({ extracted_json: { student: { usn: 'TEST001', name: 'Test Student' }, attempt, subjects: [{ subject_id: 1, internalMarks: 42, externalMarks: 34 }] } }));
  replace(db.Subject, 'findAll', async () => [definition]);
  replace(db.AcademicCourse, 'findAll', async () => [course]);
  replace(db.Student, 'findOne', async () => ({ student_id: 1, batch_id: 1, student_name: 'TEST STUDENT' }));
  replace(db.Result, 'findOne', async () => null);
  replace(db.Result, 'findAll', async () => []);
  replace(outcomes, 'load', async (batch, ids, mode) => { assert.equal(mode, 'original'); return { courses: [course], results: [], subjects: [] }; });
  replace(db.sequelize, 'transaction', () => { throw new Error('Preview must not write'); });
  try {
    let locals;
    await controller.showPreviewPage({ params: { importId: 9 } }, { render(view, data) { assert.equal(view, 'results/preview'); locals = data; }, redirect(url) { assert.fail(url); } });
    assert.equal(locals.data.cgpa, 5);
    const html = await ejs.renderFile(path.join(__dirname, '../views/results/preview.ejs'), locals);
    assert.match(html, /id="previewCumulativeCgpa">5\.00/);
    assert.match(html, /checked again on save/);
  } finally { restores.reverse().forEach(restore => restore()); }
});
