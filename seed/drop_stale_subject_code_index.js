/**
 * seed/drop_stale_subject_code_index.js
 * One-off fix for the known issue in README Troubleshooting:
 * a stale single-column UNIQUE index on subjects.subject_code blocks
 * the same subject code appearing in multiple sessions. The composite
 * UNIQUE(session_id, subject_code) remains and is correct.
 *
 * Run: node seed/drop_stale_subject_code_index.js
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
    const [idx] = await c.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subjects' " +
      "GROUP BY INDEX_NAME HAVING COUNT(DISTINCT COLUMN_NAME) = 1 AND MAX(COLUMN_NAME) = 'subject_code'"
    );
    if (idx.length === 0) {
      console.log('No stale single-column subject_code index found. Nothing to do.');
      return;
    }
    for (const row of idx) {
      console.log('Dropping stale index:', row.INDEX_NAME);
      await c.query('ALTER TABLE subjects DROP INDEX `' + row.INDEX_NAME + '`');
    }
    console.log('Done.');
  } finally {
    await c.end();
  }
})().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
