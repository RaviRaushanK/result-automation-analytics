'use strict';
// Read-only verification. Legacy-shaped row hashes permit before/after
// comparison of a column rename without treating the new key name as data loss.
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert/strict');
const { sequelize } = require('../database/models');
const period = require('../public/js/exam-period');
async function verify(beforeFile) {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const output = { tables: {}, relationships: {}, periods: [] };
  for (const oldTable of ['students', 'results', 'subject_results', 'revaluation_results', 'result_sessions', 'subjects', 'import_logs', 'subject_faculty', 'activity_logs']) {
    const table = oldTable === 'result_sessions' ? 'exam_sessions' : oldTable;
    const [rows] = await sequelize.query('SELECT * FROM `' + table + '`');
    const canonical = rows.map(row => {
      const legacy = {};
      for (const key of Object.keys(row)) legacy[key === 'exam_session_id' ? 'session_id' : key] = row[key];
      return Object.fromEntries(Object.keys(legacy).sort().map(key => [key, legacy[key]]));
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const hash = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    output.tables[table] = { before: before[oldTable].count, after: rows.length, sha256: hash, unchanged: hash === before[oldTable].hash };
    assert.equal(rows.length, before[oldTable].count, table + ' count changed');
    assert.equal(hash, before[oldTable].hash, table + ' data changed');
    if (table === 'exam_sessions') output.periods = rows.map(row => ({ id: row.exam_session_id, batch_id: row.batch_id, label: 'MCA 2025 | Sem ' + row.semester + ' | ' + period.format(row) }));
  }
  const queries = {
    resultBatch: 'SELECT COUNT(*) count FROM results r LEFT JOIN exam_sessions e ON e.exam_session_id=r.exam_session_id LEFT JOIN students s ON s.student_id=r.student_id WHERE e.exam_session_id IS NULL OR s.student_id IS NULL OR e.batch_id<>s.batch_id',
    offering: 'SELECT COUNT(*) count FROM subject_results sr LEFT JOIN results r ON r.result_id=sr.result_id LEFT JOIN subjects s ON s.subject_id=sr.subject_id WHERE r.result_id IS NULL OR s.subject_id IS NULL OR r.exam_session_id<>s.exam_session_id',
    course: 'SELECT COUNT(*) count FROM subjects s LEFT JOIN exam_sessions e ON e.exam_session_id=s.exam_session_id LEFT JOIN academic_courses c ON c.course_id=s.course_id WHERE e.exam_session_id IS NULL OR c.course_id IS NULL OR c.batch_id<>e.batch_id OR c.semester<>e.semester',
    imports: 'SELECT COUNT(*) count FROM import_logs i LEFT JOIN exam_sessions e ON e.exam_session_id=i.exam_session_id WHERE e.exam_session_id IS NULL',
    faculty: 'SELECT COUNT(*) count FROM subject_faculty sf LEFT JOIN subjects s ON s.subject_id=sf.subject_id LEFT JOIN exam_sessions e ON e.exam_session_id=s.exam_session_id WHERE s.subject_id IS NULL OR e.exam_session_id IS NULL',
  };
  for (const [name, sql] of Object.entries(queries)) {
    const [rows] = await sequelize.query(sql);
    output.relationships[name] = Number(rows[0].count);
    assert.equal(output.relationships[name], 0, name + ' relationship mismatch');
  }
  const [import85] = await sequelize.query('SELECT exam_session_id FROM import_logs WHERE import_id=85');
  assert.equal(Number(import85[0].exam_session_id), 1);
  assert.deepEqual(output.periods.map(row => Number(row.id)).sort(), [1, 2, 3]);
  await sequelize.query('SELECT * FROM effective_student_results LIMIT 1');
  console.log(JSON.stringify(output, null, 2));
}
if (require.main === module) verify(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => sequelize.close());
module.exports = { verify };
