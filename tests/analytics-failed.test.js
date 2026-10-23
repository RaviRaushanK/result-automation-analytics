'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/models');
const service = require('../services/analyticsService');
after(() => db.sequelize.close());

// CTEs shadow production tables: these scenarios never persist academic data.
const fixture = `WITH
 batches AS (SELECT 1 batch_id,'Test' batch_name),
 exam_sessions AS (SELECT 1 exam_session_id,1 batch_id,2026 exam_year,'1' semester),
 students AS (SELECT 1 student_id,'U1' usn,'Student 1' student_name UNION ALL SELECT 2,'U2','Student 2'
   UNION ALL SELECT 3,'U3','Student 3' UNION ALL SELECT 4,'U4','Student 4' UNION ALL SELECT 5,'U5','Student 5'
   UNION ALL SELECT 6,'U6','Student 6' UNION ALL SELECT 7,'U7','Student 7' UNION ALL SELECT 8,'U8','Student 8' UNION ALL SELECT 9,'U9','Student 9'),
 subjects AS (SELECT 1 subject_id,'C1' subject_code,'Course' subject_name),
 results AS (SELECT student_id result_id,student_id,1 exam_session_id,1 attempt_no,'REGULAR' exam_type FROM students
   UNION ALL SELECT 10,1,1,2,'REGULAR'),
 subject_results AS (SELECT student_id subject_result_id,student_id result_id,1 subject_id,
   CASE WHEN student_id=9 THEN NULL WHEN student_id=5 THEN 80 ELSE 30 END marks,
   CASE WHEN student_id=5 THEN 'pass' ELSE 'fail' END result_status,'F' grade FROM students
   UNION ALL SELECT 10,10,1,70,'pass','B'),
 revaluation_results AS (
   SELECT 1 revaluation_id,2 subject_result_id,1 revaluation_no,1 is_effective,'pending' revaluation_status,30 original_marks,'fail' original_status,90 revised_marks,'pass' revised_status,'O' revised_grade
   UNION ALL SELECT 2,3,1,1,'rejected',30,'fail',90,'pass','O'
   UNION ALL SELECT 3,4,1,1,'approved',30,'fail',60,'pass','B'
   UNION ALL SELECT 4,5,1,1,'approved',80,'pass',30,'fail','F'
   UNION ALL SELECT 5,6,1,1,'approved',30,'fail',60,'pass','B'
   UNION ALL SELECT 6,6,2,1,'approved',30,'fail',35.5,'fail','F'
   UNION ALL SELECT 7,6,3,1,'pending',30,'fail',100,'pass','O'
   UNION ALL SELECT 8,7,1,0,'approved',30,'fail',60,'pass','B'
   UNION ALL SELECT 9,8,1,1,'approved',30,'fail',0,'fail','F') `;

test('failed subject API compares Original and Effective truth without changing failure membership rules', { skip: process.env.REPORTS_DB_TEST !== '1' }, async t => {
  await db.sequelize.authenticate();
  const realQuery = db.sequelize.query.bind(db.sequelize), findAll = db.ExamSession.findAll;
  let calls = 0;
  db.ExamSession.findAll = async options => options.where.batch_id === 2 ? [] : [{ exam_session_id: 1 }];
  db.sequelize.query = (sql, options) => { calls++; assert.match(sql.trim(), /^SELECT\b/); return realQuery(fixture + sql, options); };
  const query = { batch_id: 1, semester: '1', exam_session_id: 1, attempt: 'all' };
  try {
    const original = await service.getFailedStudents({ ...query, mode: 'original' }, { limit: 100 });
    const effective = await service.getFailedStudents({ ...query, mode: 'effective' }, { limit: 100 });
    const byId = (response, id) => response.data.find(row => Number(row.subjectResultId) === id);
    await t.test('no revaluation falls back to original marks/status in both modes', () => {
      for (const response of [original, effective]) {
        const row = byId(response, 1); assert.equal(row.effectiveMarks, 30); assert.equal(row.effectiveStatus, 'fail');
        assert.equal(row.originalMarks, 30); assert.equal(row.hadEffectiveRevaluation, false);
      }
    });
    await t.test('pending, rejected and approved-but-inactive revisions never overlay', () => {
      for (const response of [original, effective]) for (const id of [2, 3, 7]) {
        const row = byId(response, id); assert.equal(row.effectiveMarks, 30); assert.equal(row.effectiveStatus, 'fail'); assert.equal(row.hadEffectiveRevaluation, false);
      }
    });
    await t.test('approved fail-to-pass remains auditable in Original and leaves Effective failures', () => {
      const row = byId(original, 4); assert.equal(row.originalStatus, 'fail'); assert.equal(row.effectiveStatus, 'pass'); assert.equal(row.effectiveMarks, 60);
      assert.equal(row.marks, 30); assert.equal(row.resultStatus, 'fail'); assert.equal(byId(effective, 4), undefined);
    });
    await t.test('approved pass-to-fail appears only in Effective failures with both values preserved', () => {
      assert.equal(byId(original, 5), undefined); const row = byId(effective, 5);
      assert.equal(row.originalMarks, 80); assert.equal(row.originalStatus, 'pass'); assert.equal(row.effectiveMarks, 30); assert.equal(row.effectiveStatus, 'fail');
      assert.equal(Number(row.marks), 30); assert.equal(row.hadEffectiveRevaluation, true);
    });
    await t.test('highest approved effective revision wins without duplicated records or pending override', () => {
      for (const response of [original, effective]) {
        assert.equal(response.data.filter(r => Number(r.subjectResultId) === 6).length, 1);
        assert.equal(byId(response, 6).effectiveMarks, 35.5); assert.equal(byId(response, 6).effectiveStatus, 'fail');
      }
      assert.equal(original.data.length, 8); assert.equal(effective.data.length, 8);
    });
    await t.test('zero marks are preserved and unknown marks remain null', () => {
      assert.equal(byId(effective, 8).effectiveMarks, 0); assert.equal(byId(effective, 9).effectiveMarks, null);
    });
    await t.test('latest attempts, subject filtering and empty batch scope remain enforced', async () => {
      const latest = await service.getFailedStudents({ ...query, mode: 'effective', attempt: 'latest' });
      assert.equal(byId(latest, 1), undefined);
      assert.deepEqual((await service.getFailedStudents({ ...query, subject_id: 99 })).data, []);
      const before = calls;
      assert.deepEqual((await service.getFailedStudents({ ...query, batch_id: 2 })).data, []);
      assert.equal(calls, before, 'Empty session scope never falls back to unrestricted data');
    });
  } finally { db.sequelize.query = realQuery; db.ExamSession.findAll = findAll; }
});
