'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../migrations/20261024170000-revaluation-components');
const { Sequelize } = require('sequelize');

test('migration adds only nullable fields; rollback refuses to discard explicit evidence', async () => {
  const actions = [];
  const q = { describeTable: async () => ({}), addColumn: async (...args) => actions.push(args), removeColumn: async (...args) => actions.push(args), sequelize: { query: async sql => { actions.push(sql); return [[{ used: 0 }]]; } } };
  await migration.up(q, Sequelize);
  assert.equal(actions[0][2].allowNull, true);
  assert.equal(actions[1][2].defaultValue, null);
  assert.match(actions[2], /revaluation_status='approved'/);
  assert.match(actions[2], /effective_internal_marks/);
  await migration.down(q);
  q.sequelize.query = async () => [[{ used: 1 }]];
  await assert.rejects(migration.down(q), /Rollback refused/);
});

test('isolated MySQL migration preserves rows, IDs, FKs and indexes and overlays only approved events', { skip: process.env.REVALUATION_COMPONENT_MIGRATION_TEST !== '1' }, async () => {
  const config = require('../config/config').development;
  const name = 'sraas_component_probe_' + process.pid + '_' + Date.now();
  const admin = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  let db, created = false;
  try {
    await admin.query('CREATE DATABASE `' + name + '`'); created = true;
    db = new Sequelize(name, config.username, config.password, { ...config, database: name, logging: false });
    await db.query('CREATE TABLE results (result_id INT PRIMARY KEY, student_id INT, exam_session_id INT, result_status VARCHAR(10), cgpa DECIMAL(4,2), sgpa DECIMAL(4,2), failed_subject_count INT, created_at DATETIME)');
    await db.query('CREATE TABLE subject_results (subject_result_id INT PRIMARY KEY, result_id INT, subject_id INT, internal_marks INT, external_marks INT, marks INT, grade VARCHAR(5), result_status VARCHAR(10), FOREIGN KEY(result_id) REFERENCES results(result_id))');
    await db.query('CREATE TABLE revaluation_results (revaluation_id INT PRIMARY KEY, subject_result_id INT, revaluation_no INT, is_effective INT, revaluation_status VARCHAR(20), revised_marks INT, revised_grade VARCHAR(5), revised_status VARCHAR(10), UNIQUE KEY event_no(subject_result_id,revaluation_no), FOREIGN KEY(subject_result_id) REFERENCES subject_results(subject_result_id))');
    await db.query("INSERT INTO results VALUES (1,1,1,'fail',5.44,5.44,1,'2026-01-01')");
    await db.query("INSERT INTO subject_results VALUES (1,1,1,30,15,45,'F','fail')");
    await db.query("INSERT INTO revaluation_results VALUES (5,1,1,1,'approved',50,'C','pass'),(6,1,2,1,'pending',99,'O','pass')");
    const [before] = await db.query('SELECT * FROM revaluation_results');
    const [definition] = await db.query('SHOW CREATE TABLE revaluation_results');
    await migration.up(db.getQueryInterface(), Sequelize);
    const schema = await db.getQueryInterface().describeTable('revaluation_results');
    assert.equal(schema.revised_internal_marks.allowNull, true);
    const [after] = await db.query('SELECT revaluation_id,subject_result_id,revaluation_no,is_effective,revaluation_status,revised_marks,revised_grade,revised_status FROM revaluation_results');
    assert.deepEqual(after, before);
    const [view] = await db.query('SELECT * FROM effective_student_results');
    assert.deepEqual([view[0].effective_external_marks, view[0].effective_total_marks, view[0].effective_result], [15,50,'pass']);
    await db.query('UPDATE revaluation_results SET revised_external_marks=20 WHERE revaluation_id=5');
    const [withEX] = await db.query('SELECT * FROM effective_student_results');
    assert.deepEqual([withEX[0].effective_internal_marks,withEX[0].effective_external_marks,withEX[0].effective_total_marks], [30,20,50]);
    assert.equal(Number(withEX[0].sgpa), 5.44);
    await assert.rejects(migration.down(db.getQueryInterface()), /Rollback refused/);
    await db.query('UPDATE revaluation_results SET revised_external_marks=NULL');
    await migration.down(db.getQueryInterface());
    const [finalDefinition] = await db.query('SHOW CREATE TABLE revaluation_results');
    assert.deepEqual(finalDefinition, definition);
  } finally {
    if (db) await db.close();
    if (created) await admin.query('DROP DATABASE `' + name + '`');
    await admin.close();
  }
});
