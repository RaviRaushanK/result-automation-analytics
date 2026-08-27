require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const [r] = await c.query("SELECT COUNT(*) c FROM results WHERE attempt_no > 1 OR exam_type <> 'REGULAR'");
  console.log('rows w/ attempt>1 or non-REGULAR:', r[0].c);
  const [r2] = await c.query("SELECT COUNT(*) c FROM results WHERE result_uuid='00000000-0000-0000-0000-00000000DEAD'");
  console.log('crafted-uuid rows:', r2[0].c);
  const [r3] = await c.query("SELECT COUNT(*) c FROM results");
  console.log('total results:', r3[0].c);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });