require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  const batchId = 4;
  // Delete in safe FK order (SEC test artifacts only).
  const [st] = await c.query('SELECT student_id FROM students WHERE batch_id=?', [batchId]);
  const ids = st.map(r => r.student_id);
  if (ids.length) await c.query(`DELETE FROM results WHERE student_id IN (${ids.join(',')})`);
  if (ids.length) await c.query(`DELETE FROM students WHERE student_id IN (${ids.join(',')})`);
  await c.query('DELETE FROM result_sessions WHERE batch_id=?', [batchId]);
  await c.query('DELETE FROM batches WHERE batch_id=?', [batchId]);
  console.log('Deleted SEC test batch', batchId, 'students', JSON.stringify(ids));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });