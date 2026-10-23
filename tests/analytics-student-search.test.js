'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/models');
const repository = require('../repositories/analyticsRepository');
const service = require('../services/analyticsService');
after(() => db.sequelize.close());

test('Student Analytics searches partial USN or name with escaped bound text and preserves filters', async () => {
  const query = db.sequelize.query, sessions = db.ExamSession.findAll;
  const calls = [];
  db.ExamSession.findAll = async () => [{ exam_session_id: 7 }];
  db.sequelize.query = async (sql, options) => { calls.push({ sql, options }); return []; };
  try {
    for (const usn of [' 1mv25mc ', ' Ravi ', "%' OR 1=1 --_"]) {
      await service.getStudentAnalytics({ usn, batch_id: 1, semester: '1', mode: 'effective', attempt: 'latest' }, { limit: 25, offset: 25 });
      const call = calls.at(-1);
      assert.match(call.sql, /st\.usn LIKE :studentSearch OR st\.student_name LIKE :studentSearch/);
      assert.doesNotMatch(call.sql, /st\.usn = :usn/);
      assert.equal(call.options.replacements.studentSearch, '%' + usn.trim().replace(/[\\%_]/g, '\\$&') + '%');
      assert.equal(call.options.replacements.limitValue, 25);
      assert.equal(call.options.replacements.offsetValue, 25);
      assert.deepEqual(call.options.replacements.examSessionIds, [7]);
      assert.match(call.sql, /max_attempt_no/);
      assert.match(call.sql, /eff\.revised_status/);
    }
    await repository.getStudentAnalytics({ usn: '   ' });
    assert.doesNotMatch(calls.at(-1).sql, /studentSearch/);
    await repository.getFailedStudents({ usn: 'EXACT' });
    assert.match(calls.at(-1).sql, /st\.usn = :usn/);
    assert.doesNotMatch(calls.at(-1).sql, /studentSearch/);
  } finally { db.sequelize.query = query; db.ExamSession.findAll = sessions; }
});

test('read-only MySQL Student Analytics matches partial, mixed-case USN and name without inventing results', { skip: process.env.REPORTS_DB_TEST !== '1' }, async () => {
  const [identities] = await db.sequelize.query(`SELECT DISTINCT st.usn,st.student_name,st.batch_id FROM students st
    JOIN results r ON r.student_id=st.student_id JOIN subject_results sr ON sr.result_id=r.result_id
    JOIN exam_sessions rs ON rs.exam_session_id=r.exam_session_id AND rs.batch_id=st.batch_id
    WHERE st.deleted_at IS NULL ORDER BY st.usn LIMIT 1`);
  if (!identities.length) return;
  const identity = identities[0];
  for (const usn of [identity.usn, identity.usn.toLowerCase().slice(0, -2), identity.student_name.split(' ')[0].toLowerCase()]) {
    const result = await service.getStudentAnalytics({ batch_id: identity.batch_id, usn }, { limit: 100 });
    assert.ok(result.data.some(row => row.usn === identity.usn), usn);
    assert.ok(result.data.every(row => (row.usn + ' ' + row.studentName).toLowerCase().includes(usn.toLowerCase())));
  }
  assert.equal((await service.getStudentAnalytics({ batch_id: identity.batch_id, usn: 'NoSuchStudent-8171923' })).data.length, 0);
  const literal = await service.getStudentAnalytics({ batch_id: identity.batch_id, usn: '%' });
  assert.ok(literal.data.every(row => (row.usn + row.studentName).includes('%')));
});
