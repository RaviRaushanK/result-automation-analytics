require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');
const { sequelize, Result } = require('../database/models');

(async () => {
  // --- Raw SQL (ground truth) ---
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });

  const [[row105]] = await c.query(
    'SELECT result_id, student_id, session_id, attempt_no, exam_type, result_uuid FROM results WHERE result_id=105'
  );
  console.log('PRESERVED raw result 105:', JSON.stringify(row105[0]));

  const [[total]] = await c.query('SELECT COUNT(*) AS c FROM results');
  console.log('total results (raw):', total[0].c);

  const [[idxList]] = await c.query("SHOW INDEX FROM results WHERE Key_name='unique_student_session_attempt'");
  console.log('unique_student_session_attempt present:', idxList.length > 0);

  const [[batches]] = await c.query("SELECT batch_id FROM batches WHERE batch_name='__SEC_TEST__'");
  const [[secStudents]] = await c.query("SELECT student_id FROM students WHERE student_name LIKE 'SEC-T-%'");
  const [[secResults]] = await c.query("SELECT result_id FROM results WHERE result_uuid LIKE 'sraas-sec-%'");
  console.log('SEC leak -> batches:', batches.length, 'students:', secStudents.length, 'results:', secResults.length);

  await c.end();

  // --- App's own Sequelize connection ---
  const found = await Result.findByPk(105);
  console.log('Sequelize sees result 105:', found ? `{attempt_no:${found.attempt_no},exam_type:${found.exam_type}}` : 'MISSING');
  console.log('Sequelize model defaults:', Result.build({}).attempt_no, Result.build({}).exam_type);
})().catch(e => { console.error('ERR', e && e.message ? e.message : e); process.exit(1); });

