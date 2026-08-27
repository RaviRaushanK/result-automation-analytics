require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const [rows] = await c.query("SELECT result_id, student_id, session_id, attempt_no, exam_type, sgpa, result_uuid FROM results WHERE attempt_no > 1 OR exam_type <> 'REGULAR'");
  for (const r of rows) console.log(JSON.stringify(r));
  const [stu] = await c.query("SELECT student_id, usn, student_name, batch_id FROM students WHERE usn LIKE 'SEC-T-%' OR student_name='Sec Test'");
  for (const r of stu) console.log('STUDENT', JSON.stringify(r));
  const [sess] = await c.query("SELECT session_id, semester, batch_id FROM result_sessions WHERE semester LIKE '%SEC%'");
  for (const r of sess) console.log('SESSION', JSON.stringify(r));
  const [batch] = await c.query("SELECT batch_id, batch_name FROM batches WHERE batch_name LIKE '%SEC%'");
  for (const r of batch) console.log('BATCH', JSON.stringify(r));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });