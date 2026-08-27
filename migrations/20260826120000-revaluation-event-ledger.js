'use strict';

const { Sequelize } = require('sequelize');

/**
 * Revaluation foundation: convert revaluation_results from an implicit
 * 1-per-subject_result row into an explicit append-only EVENT LEDGER.
 *  - revaluation_no : sequence of revaluation events for the SAME subject
 *                     result (history preserved, never overwritten).
 *  - is_effective   : marks the single event feeding effective results.
 *  - reviewed_by/at : approval audit trail.
 *  - uploaded_by    : tightened to NOT NULL (matches the Sequelize model).
 *  - import_logs.import_type separates ORIGINAL vs REVALUATION imports
 *    (DEFAULT 'ORIGINAL' leaves the untouched original flow valid).
 *  - effective_student_results rebuilt to overlay ONLY the effective event
 *    (avoids LEFT-JOIN fan-out) and to honour revised_grade.
 *
 * All steps are idempotent via information_schema guards so a partial
 * failure mid-migration can be retried safely.
 */
const colExists = async (qi, table, col) => {
  const [rows] = await qi.sequelize.query(
    'SELECT COUNT(*) AS cnt FROM information_schema.columns ' +
    'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    { replacements: [table, col] }
  );
  return Number(rows[0].cnt) > 0;
};
const idxExists = async (qi, name) => {
  const [rows] = await qi.sequelize.query(
    'SELECT COUNT(*) AS cnt FROM information_schema.statistics ' +
    'WHERE table_schema = DATABASE() AND index_name = ?',
    { replacements: [name] }
  );
  return Number(rows[0].cnt) > 0;
};

module.exports = {
  up: async (queryInterface) => {
    // Pre-check: tightening uploaded_by must not orphan legacy NULLs.
    const [nulls] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM revaluation_results WHERE uploaded_by IS NULL'
    );
    if (Number(nulls[0].cnt) > 0) {
      throw new Error('Migration aborted: revaluation_results has ' +
        nulls[0].cnt + ' row(s) with NULL uploaded_by.');
    }

    // 1) Event ledger columns (idempotent)
    if (!(await colExists(queryInterface, 'revaluation_results', 'revaluation_no'))) {
      await queryInterface.addColumn('revaluation_results', 'revaluation_no', {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 1,
        comment: 'Sequence of revaluation events for this subject result (history preserved)'
      });
    }
    if (!(await colExists(queryInterface, 'revaluation_results', 'is_effective'))) {
      await queryInterface.addColumn('revaluation_results', 'is_effective', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
        comment: 'The single event whose outcome feeds effective results'
      });
    }
    if (!(await colExists(queryInterface, 'revaluation_results', 'reviewed_by'))) {
      await queryInterface.addColumn('revaluation_results', 'reviewed_by', {
        type: Sequelize.BIGINT, allowNull: true,
        references: { model: 'admin_users', key: 'admin_id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      });
    }
    if (!(await colExists(queryInterface, 'revaluation_results', 'reviewed_at'))) {
      await queryInterface.addColumn('revaluation_results', 'reviewed_at', {
        type: Sequelize.DATE, allowNull: true
      });
    }

    // 2) Align uploaded_by with the model (idempotent re-change)
    await queryInterface.changeColumn('revaluation_results', 'uploaded_by', {
      type: Sequelize.BIGINT, allowNull: false
    });

    // 3) Uniqueness per subject_result + event sequence.
    //    KEEP the existing plain idx_revaluation_subject_result (required by
    //    the FK on subject_result_id — MySQL refuses to drop it and it is
    //    still useful for lookups); ADD the composite unique on top.
    if (!(await idxExists(queryInterface, 'unique_reval_event'))) {
      await queryInterface.addIndex('revaluation_results',
        ['subject_result_id', 'revaluation_no'],
        { name: 'unique_reval_event', unique: true });
    }

    // 4) Distinguish import flows (idempotent)
    if (!(await colExists(queryInterface, 'import_logs', 'import_type'))) {
      await queryInterface.addColumn('import_logs', 'import_type', {
        type: Sequelize.ENUM('ORIGINAL', 'REVALUATION'),
        allowNull: false, defaultValue: 'ORIGINAL',
        comment: 'Which upload flow produced this log entry'
      });
    }

    // 5) Rebuild view: one row per subject result using ONLY the effective
    //    revaluation event; honours revised_grade per docs intent.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE VIEW effective_student_results AS
      SELECT
        rr.result_id, rr.student_id, rr.session_id, srs.subject_id,
        COALESCE(eff.revised_marks, srs.marks) AS effective_marks,
        COALESCE(eff.revised_grade, srs.grade) AS effective_grade,
        rr.result_status, rr.cgpa, rr.sgpa, rr.failed_subject_count, rr.created_at
      FROM results rr
      JOIN subject_results srs ON rr.result_id = srs.result_id
      LEFT JOIN revaluation_results eff
             ON eff.subject_result_id = srs.subject_result_id
            AND eff.is_effective = 1;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE VIEW effective_student_results AS
      SELECT
        rr.result_id, rr.student_id, rr.session_id, srs.subject_id,
        COALESCE(rr_rev.revised_marks, srs.marks) AS effective_marks,
        srs.grade AS effective_grade,
        rr.result_status, rr.cgpa, rr.sgpa, rr.failed_subject_count, rr.created_at
      FROM results rr
      JOIN subject_results srs ON rr.result_id = srs.result_id
      LEFT JOIN revaluation_results rr_rev ON srs.subject_result_id = rr_rev.subject_result_id;
    `);

    if (await idxExists(queryInterface, 'unique_reval_event')) {
      await queryInterface.removeIndex('revaluation_results', 'unique_reval_event');
    }
    await queryInterface.removeColumn('import_logs', 'import_type');
    for (const c of ['reviewed_at', 'reviewed_by', 'is_effective', 'revaluation_no']) {
      await queryInterface.removeColumn('revaluation_results', c);
    }
    // NOTE: uploaded_by remains NOT NULL on rollback (model expects it).
  }
};