'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize } = require('sequelize');
const migration = require('../migrations/20261023130000-rename-examination-session-domain');

test('isolated MySQL up/down preserve IDs, rows, FKs, indexes, period checks, view and auth store', { skip: process.env.EXAM_SESSION_MIGRATION_TEST !== '1' }, async () => {
  const config = require('../config/config').development;
  const name = 'sraas_exam_session_probe_' + process.pid + '_' + Date.now();
  const admin = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  let db, created = false;
  try {
    await admin.query('CREATE DATABASE `' + name + '`');
    created = true;
    db = new Sequelize(name, config.username, config.password, { ...config, database: name, logging: false });
    await db.query('CREATE TABLE batches (batch_id BIGINT PRIMARY KEY)');
    await db.query(`CREATE TABLE result_sessions (
      session_id BIGINT AUTO_INCREMENT PRIMARY KEY, batch_id BIGINT NOT NULL, semester VARCHAR(20),
      exam_start_month TINYINT UNSIGNED NOT NULL, exam_start_year SMALLINT UNSIGNED NOT NULL,
      exam_end_month TINYINT UNSIGNED NOT NULL, exam_end_year SMALLINT UNSIGNED NOT NULL,
      UNIQUE KEY unique_session_exam_period (batch_id,semester,exam_start_month,exam_start_year,exam_end_month,exam_end_year),
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT result_sessions_start_month_check CHECK (exam_start_month BETWEEN 1 AND 12),
      CONSTRAINT result_sessions_end_month_check CHECK (exam_end_month BETWEEN 1 AND 12),
      CONSTRAINT result_sessions_period_order_check CHECK ((exam_end_year*12+exam_end_month)>=(exam_start_year*12+exam_start_month)))`);
    for (const [table, id] of [['results', 'result_id'], ['subjects', 'subject_id'], ['import_logs', 'import_id']]) {
      await db.query(`CREATE TABLE ${table} (${id} BIGINT PRIMARY KEY, session_id BIGINT NOT NULL,
        UNIQUE KEY unique_fixture_session (${id},session_id),
        FOREIGN KEY (session_id) REFERENCES result_sessions(session_id) ON DELETE RESTRICT ON UPDATE CASCADE)`);
    }
    await db.query('CREATE TABLE sessions (session_id VARCHAR(100) PRIMARY KEY, data TEXT)');
    await db.query("INSERT INTO sessions VALUES ('login-fixture','unchanged')");
    await db.query('INSERT INTO batches VALUES (1)');
    await db.query("INSERT INTO result_sessions VALUES (1,1,'1',12,2025,1,2026),(2,1,'2',5,2026,6,2026),(3,1,'3',3,2027,3,2027)");
    for (const [table, id] of [['results', 10], ['subjects', 20], ['import_logs', 85]]) await db.query(`INSERT INTO ${table} VALUES (${id},1)`);
    await db.query('CREATE VIEW effective_student_results AS SELECT r.result_id,r.session_id FROM results r JOIN result_sessions s ON s.session_id=r.session_id');
    const before = {};
    for (const table of ['result_sessions', 'results', 'subjects', 'import_logs', 'sessions']) before[table] = (await db.query('SELECT * FROM `' + table + '`'))[0];
    const qi = db.getQueryInterface();
    await migration.up(qi);
    await migration.up(qi); // Resume/retry without copying or duplicating data.
    for (const table of ['exam_sessions', 'results', 'subjects', 'import_logs']) {
      const [rows] = await db.query('SELECT * FROM `' + table + '`');
      const canonical = rows.map(({ exam_session_id, ...row }) => ({ ...row, session_id: exam_session_id }));
      const old = before[table === 'exam_sessions' ? 'result_sessions' : table];
      assert.deepEqual(canonical, old);
    }
    assert.deepEqual((await db.query('SELECT * FROM sessions'))[0], before.sessions);
    assert.equal((await db.query('SELECT exam_session_id FROM effective_student_results'))[0][0].exam_session_id, 1);
    const [fks] = await db.query("SELECT TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='exam_sessions'");
    assert.equal(fks.length, 3);
    assert.ok(fks.every(fk => fk.REFERENCED_COLUMN_NAME === 'exam_session_id'));
    await assert.rejects(db.query('DELETE FROM exam_sessions WHERE exam_session_id=1'));
    await assert.rejects(db.query('INSERT INTO results VALUES (99,999)'));
    await assert.rejects(db.query("INSERT INTO exam_sessions VALUES (9,1,'1',12,2025,1,2026)"));
    await assert.rejects(db.query('UPDATE exam_sessions SET exam_start_month=13 WHERE exam_session_id=1'));
    await assert.rejects(db.query('UPDATE exam_sessions SET exam_end_year=2024 WHERE exam_session_id=1'));
    await migration.down(qi);
    for (const table of Object.keys(before)) assert.deepEqual((await db.query('SELECT * FROM `' + table + '`'))[0], before[table]);
    assert.equal((await db.query('SELECT session_id FROM effective_student_results'))[0][0].session_id, 1);
    await migration.up(qi);
  } finally {
    if (db) await db.close();
    if (created) {
      assert.match(name, /^sraas_exam_session_probe_\d+_\d+$/);
      assert.notEqual(name, config.database);
      await admin.query('DROP DATABASE `' + name + '`');
    }
    await admin.close();
  }
});
