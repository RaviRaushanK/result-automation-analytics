'use strict';

/**
 * Subject-code uniqueness scope: batch + session + subject code.
 *
 * The original table creation declared `subjects.subject_code` as globally
 * UNIQUE (MySQL index name `subject_code`). The intended rule is that a subject
 * code is only unique inside one batch/session pair (session_id), which is what
 * the `unique_session_subject_code` index enforces.
 *
 * The earlier 20231101000000-modify-schema migration tried to drop the legacy
 * constraint under its PostgreSQL name (`subjects_subject_code_key`), which
 * does not exist on MySQL, so the stale global UNIQUE index survived.
 *
 * Dropping a redundant unique index changes no data; it only stops the database
 * from rejecting the very same code in a different batch/session.
 */
module.exports = {
  up: async (queryInterface) => {
    const [indexes] = await queryInterface.sequelize.query(`
      SELECT INDEX_NAME, NON_UNIQUE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'subjects'
        AND INDEX_NAME = 'subject_code'
    `);
    if (indexes.some((row) => Number(row.NON_UNIQUE) === 0)) {
      await queryInterface.removeIndex('subjects', 'subject_code');
    }

    // The composite rule (session_id, subject_code) must be in place.
    const [composite] = await queryInterface.sequelize.query(`
      SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'subjects'
        AND INDEX_NAME = 'unique_session_subject_code'
    `);
    if (composite.length !== 2) {
      await queryInterface.addConstraint('subjects', {
        fields: ['session_id', 'subject_code'],
        type: 'unique',
        name: 'unique_session_subject_code'
      });
    }
  },

  down: async (queryInterface) => {
    // Restore the legacy global unique index only while the codes are still
    // unique across the whole table (the original behaviour).
    const [dupes] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT subject_code FROM subjects GROUP BY subject_code HAVING COUNT(*) > 1
      ) AS d
    `);
    if (Number(dupes[0].cnt) > 0) {
      throw new Error(
        'Rollback aborted: duplicate subject codes exist across sessions, so the legacy global UNIQUE index cannot be restored.'
      );
    }
    await queryInterface.addIndex('subjects', {
      fields: ['subject_code'],
      unique: true,
      name: 'subject_code'
    });
  }
};
