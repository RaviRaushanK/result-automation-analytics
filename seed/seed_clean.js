/**
 * seed/seed_clean.js
 * Hard-deletes the seeded rows (raw SQL — avoids FK constraint
 * hassles). Removes all data owned by the MCA 2025 batch.
 *
 * Run: node seed/seed_clean.js
 */
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const mysql = require('mysql2/promise');

async function clean() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  console.log('\n=== CLEANING SEEDED DATA ===\n');

  try {
    // Find the batch first
    const [batches] = await c.query(
      "SELECT b.batch_id FROM batches b JOIN departments d ON b.department_id=d.department_id WHERE d.department_code='MCA' AND b.batch_name='MCA 2025'"
    );
    if (batches.length === 0) {
      console.log('No MCA 2025 batch found. Nothing to clean.');
      await c.end(); return;
    }
    const batchId = batches[0].batch_id;
    console.log('Found batch_id =', batchId);

    // Find sessions for that batch
    const [sessions] = await c.query("SELECT session_id FROM result_sessions WHERE batch_id = ?", [batchId]);
    const sessionIds = sessions.map(s => s.session_id);
    console.log('Found sessions:', sessionIds);

    if (sessionIds.length > 0) {
      // Delete in dependency order
      // 1. ocr_extractions -> import_logs (delete ocr first, then import logs)
      const [imports] = await c.query("SELECT import_id FROM import_logs WHERE session_id IN (?)", [sessionIds]);
      const importIds = imports.map(i => i.import_id);
      if (importIds.length > 0) {
        const [ocrRes] = await c.query("DELETE FROM ocr_extractions WHERE import_id IN (?)", [importIds]);
        console.log('Deleted ocr_extractions:', ocrRes.affectedRows);
        const [impRes] = await c.query("DELETE FROM import_logs WHERE import_id IN (?)", [importIds]);
        console.log('Deleted import_logs:', impRes.affectedRows);
      }

      // 2. revaluation_results (via subject_results in those sessions)
      const [srs] = await c.query(
        "SELECT sr.subject_result_id FROM subject_results sr JOIN results r ON sr.result_id=r.result_id WHERE r.session_id IN (?)",
        [sessionIds]
      );
      const srIds = srs.map(s => s.subject_result_id);
      if (srIds.length > 0) {
        const [revRes] = await c.query("DELETE FROM revaluation_results WHERE subject_result_id IN (?)", [srIds]);
        console.log('Deleted revaluation_results:', revRes.affectedRows);
      }

      // 3. subject_results -> results
      const [res1] = await c.query("DELETE FROM subject_results WHERE result_id IN (SELECT result_id FROM results WHERE session_id IN (?))", [sessionIds]);
      console.log('Deleted subject_results:', res1.affectedRows);
      const [res2] = await c.query("DELETE FROM results WHERE session_id IN (?)", [sessionIds]);
      console.log('Deleted results:', res2.affectedRows);

      // 4. subjects
      const [res3] = await c.query("DELETE FROM subjects WHERE session_id IN (?)", [sessionIds]);
      console.log('Deleted subjects:', res3.affectedRows);

      // 5. result_sessions
      const [res4] = await c.query("DELETE FROM result_sessions WHERE session_id IN (?)", [sessionIds]);
      console.log('Deleted result_sessions:', res4.affectedRows);
    }

    // 6. students in that batch
    const [res5] = await c.query("DELETE FROM students WHERE batch_id = ?", [batchId]);
    console.log('Deleted students:', res5.affectedRows);

    // 7. batches
    const [res6] = await c.query("DELETE FROM batches WHERE batch_id = ?", [batchId]);
    console.log('Deleted batches:', res6.affectedRows);

    // 8. department
    const [res7] = await c.query("DELETE FROM departments WHERE department_code = 'MCA'");
    console.log('Deleted departments:', res7.affectedRows);

    console.log('\n=== CLEAN COMPLETE ===\n');
  } catch (err) {
    console.error('CLEAN FAILED:', err.message);
    throw err;
  } finally {
    await c.end();
  }
}

clean().catch(err => { process.exit(1); });
