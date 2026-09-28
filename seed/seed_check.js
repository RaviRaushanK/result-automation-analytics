/**
 * seed/seed_check.js
 * Read-only validation of seeded history data.
 * Run: node seed/seed_check.js
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  try {
    const [batches] = await c.query(
      'SELECT batch_id, batch_name FROM batches ORDER BY batch_id'
    );
    for (const b of batches) {
      console.log('\n' + b.batch_name + ' (id=' + b.batch_id + ')');
      const [students] = await c.query(
        'SELECT COUNT(*) n, MIN(usn) min_usn, MAX(usn) max_usn FROM students WHERE batch_id = ?', [b.batch_id]
      );
      console.log('  students: ' + students[0].n + '  USN ' + students[0].min_usn + ' .. ' + students[0].max_usn);
      const [sessions] = await c.query(
        'SELECT session_id, semester, exam_session, exam_year FROM result_sessions WHERE batch_id = ?', [b.batch_id]
      );
      for (const s of sessions) {
        const [r] = await c.query(
          'SELECT COUNT(*) n, SUM(result_status="pass") pass, SUM(result_status="fail") fail, ' +
          'SUM(cgpa IS NULL) cgpa_null, SUM(sgpa IS NULL) sgpa_null, ' +
          'SUM(attempt_no=2) attempts2, SUM(exam_type="BACKLOG") backlogs ' +
          'FROM results WHERE session_id = ?', [s.session_id]
        );
        const [sr] = await c.query(
          'SELECT COUNT(*) n, SUM(sr.result_status="fail") fail FROM subject_results sr ' +
          'JOIN results r ON r.result_id=sr.result_id WHERE r.session_id = ?', [s.session_id]
        );
        console.log('  Sem' + s.semester + ' ' + s.exam_session + ' ' + s.exam_year +
          ': results=' + r[0].n + ' pass=' + (r[0].pass || 0) + ' fail=' + (r[0].fail || 0) +
          ' cgpa_null=' + (r[0].cgpa_null || 0) + ' sgpa_null=' + (r[0].sgpa_null || 0) +
          ' attempt2=' + (r[0].attempts2 || 0) +
          ' | subj_results=' + sr[0].n + ' failed=' + (sr[0].fail || 0));
      }
    }

    // USN uniqueness across batches (must be zero)
    const [dup] = await c.query(
      'SELECT usn, COUNT(*) c FROM students GROUP BY usn HAVING c > 1'
    );
    console.log('\nDuplicate USNs: ' + dup.length);
  } finally {
    await c.end();
  }
})().catch(err => { console.error('CHECK FAILED:', err.message); process.exit(1); });
