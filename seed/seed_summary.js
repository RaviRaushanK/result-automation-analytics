/**
 * seed/seed_summary.js
 * Prints a read-only summary of seeded data in the database.
 * Run: node seed/seed_summary.js
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const db = require('../database/models');
const { Department, Batch, ResultSession, Student, Subject, Result, SubjectResult } = db;

async function summary() {
  await db.sequelize.authenticate();
  console.log('\n=== DATABASE SUMMARY ===\n');

  const depts = await Department.findAll({ where: { status: 'active' } });
  for (const d of depts) {
    console.log('Department:', d.department_name, '(id=' + d.department_id + ', code=' + d.department_code + ')');
    const batches = await Batch.findAll({ where: { department_id: d.department_id, status: 'active' } });
    for (const b of batches) {
      console.log('  Batch:', b.batch_name, '(id=' + b.batch_id + ', years=' + b.start_year + '-' + b.end_year + ')');
      const sessions = await ResultSession.findAll({ where: { batch_id: b.batch_id } });
      for (const s of sessions) {
        const subCount = await Subject.count({ where: { session_id: s.session_id } });
        const resCount = await Result.count({ where: { session_id: s.session_id } });
        const stuCount = await Student.count({ where: { batch_id: b.batch_id } });
        const passCount = await Result.count({ where: { session_id: s.session_id, result_status: 'pass' } });
        const failCount = await Result.count({ where: { session_id: s.session_id, result_status: 'fail' } });
        console.log('    Session: Sem ' + s.semester + ' ' + s.exam_session + ' ' + s.exam_year +
          ' (id=' + s.session_id + ')');
        console.log('      Students: ' + stuCount + '  Results: ' + resCount +
          '  Subjects: ' + subCount);
        console.log('      Pass: ' + passCount + '  Fail: ' + failCount);
        const subs = await Subject.findAll({ where: { session_id: s.session_id } });
        for (const sub of subs) {
          const srPass = await SubjectResult.count({
            where: { subject_id: sub.subject_id, result_status: 'pass' }
          });
          const srTotal = await SubjectResult.count({ where: { subject_id: sub.subject_id } });
          console.log('        ' + sub.subject_code + ' ' + sub.subject_name +
            ' credits=' + sub.credits + ' (' + srPass + '/' + srTotal + ' passed)');
        }
      }
    }
  }
  console.log('\n=== END SUMMARY ===\n');
  await db.sequelize.close();
}

summary().catch(err => {
  console.error('SUMMARY FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
