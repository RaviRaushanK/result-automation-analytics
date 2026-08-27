require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');

(async () => {
  console.log('env:', { host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, db: process.env.DB_NAME, hasPass: !!process.env.DB_PASSWORD });

  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });

      const [[t]] = await c.query('SELECT COUNT(*) AS c FROM results');
  console.log('total results:', JSON.stringify(t));

  const [[nonStandard]] = await c.query(
    `SELECT result_id, student_id, session_id, attempt_no, exam_type, result_uuid
     FROM results WHERE attempt_no > 1 OR exam_type != 'REGULAR' OR result_uuid LIKE 'sraas-sec-%'`
  );
  console.log('NON-STANDARD results (attempt>1 / non-REGULAR / SEC-uuid):', JSON.stringify(nonStandard, null, 2));

  await c.query('SET NAMES utf8mb4');
  try {
    // batch
    let [b] = await c.query("SELECT batch_id, batch_name FROM batches WHERE batch_name='__SEC_TEST__'");
    console.log('SEC batches:', JSON.stringify(b));
    const batchId = b[0]?.batch_id;
    // students
    let s = [];
    if (batchId) [s] = await c.query('SELECT student_id, student_name, batch_id FROM students WHERE batch_id=?', [batchId]);
    else [s] = await c.query("SELECT student_id, student_name, batch_id FROM students WHERE student_name LIKE 'SEC-T-%'");
    console.log('SEC students count:', s.length, JSON.stringify(s));
    // results belonging to those students
    let secResults = [];
    if (s.length) {
      const idsCsv = s.map(x => x.student_id).join(',');
      [secResults] = await c.query(`SELECT result_id, student_id, session_id, attempt_no, exam_type, result_uuid FROM results WHERE student_id IN (${idsCsv})`);
    }
    console.log('SEC leftover results:', JSON.stringify(secResults));
    // sessions
    let sess = [];
    if (batchId) [sess] = await c.query('SELECT session_id, batch_id FROM result_sessions WHERE batch_id=?', [batchId]);
    console.log('SEC sessions:', JSON.stringify(sess));
    // subjects referencing SEC sessions
    let subj = [];
    if (sess.length) {
      const sidCsv = sess.map(x=>x.session_id).join(',');
      [subj] = await c.query(`SELECT subject_id, subject_code, session_id FROM subjects WHERE session_id IN (${sidCsv})`);
    }
    console.log('SEC subjects:', JSON.stringify(subj));
  } catch (e) { console.error('QUERY ERR', e && e.message ? e.message : e); }


  await c.end();
})().catch(e => { console.error('ERR', e && e.message ? e.message : e); process.exit(1); });
