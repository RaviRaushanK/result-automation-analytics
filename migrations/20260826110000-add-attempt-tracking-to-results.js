'use strict';

const { Sequelize } = require('sequelize');

/**
 * Attempt tracking for results (foundation for revaluation module).
 *
 *  - attempt_no : 1st, 2nd, 3rd ... participation of a student in this
 *                 exam session (per-student, lives on `results`, NOT on the
 *                 shared result_sessions exam-event row).
 *  - exam_type  : REGULAR | BACKLOG | SUPPLEMENTARY | REPEAT
 *
 * NOTE: No maximum-attempt limit is encoded anywhere in the database.
 * Eligibility rules (e.g. max backlog attempts) remain configurable
 * business rules (SystemSetting) enforced by application logic.
 *
 * Existing rows keep the DEFAULT values, so every current result becomes
 * attempt 1 / REGULAR — behaviour of the running original-result upload
 * flow is unchanged.
 */
module.exports = {
  up: async (queryInterface) => {
    // Fail loudly rather than corrupt data: the new composite unique key
    // below cannot be added while duplicate (student_id, session_id) rows
    // exist. The running app guards duplicates at application level, so
    // this should always be zero unless a race slipped past it historically.
    const [dupes] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT student_id, session_id
        FROM results
        GROUP BY student_id, session_id
        HAVING COUNT(*) > 1
      ) AS d
    `);
    if (Number(dupes[0].cnt) > 0) {
      throw new Error(
        'Migration aborted: results contains ' + dupes[0].cnt +
        ' duplicate (student_id, session_id) group(s). ' +
        'Resolve them manually before adding unique_student_session_attempt.'
      );
    }

    // 1) Attempt identity columns (defaults preserve existing semantics)
    await queryInterface.addColumn('results', 'attempt_no', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Attempt number for this student+session; 1 = first sitting. No schema-level cap.'
    });

    await queryInterface.addColumn('results', 'exam_type', {
      type: Sequelize.ENUM('REGULAR', 'BACKLOG', 'SUPPLEMENTARY', 'REPEAT'),
      allowNull: false,
      defaultValue: 'REGULAR',
      comment: 'Kind of exam participation this result belongs to'
    });

    // 2) DB-enforced duplicate guard (previously application-level only)
    await queryInterface.addConstraint('results', {
      fields: ['student_id', 'session_id', 'attempt_no'],
      type: 'unique',
      name: 'unique_student_session_attempt'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeConstraint('results', 'unique_student_session_attempt');
    await queryInterface.removeColumn('results', 'exam_type');
    await queryInterface.removeColumn('results', 'attempt_no');
  }
};