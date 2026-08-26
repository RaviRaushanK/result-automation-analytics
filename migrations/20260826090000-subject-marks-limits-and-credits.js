'use strict';

/**
 * Per-subject marks ceilings + real credits for the upload validation engine.
 *
 *  - max_internal / max_external / max_marks: server-side validation bounds
 *    (defaults by subject_type: theory 50/100/150, lab 50/50/100).
 *  - credits backfill: seeder shipped NULL credits, which made SGPA divide by
 *    zero. P.G. 2022/2024 scheme assumes credit-bearing courses; 4 is the
 *    scheme's documented working assumption in seed-mca.js.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('subjects', 'max_internal', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 50,
      comment: 'Maximum internal/CIE marks for this subject'
    });
    await queryInterface.addColumn('subjects', 'max_external', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 100,
      comment: 'Maximum external/SEE marks for this subject'
    });
    await queryInterface.addColumn('subjects', 'max_marks', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 150,
      comment: 'Maximum total marks; grade % is computed against this'
    });

    // Lab subjects: 50 internal + 50 external = 100 total
    await queryInterface.bulkUpdate('subjects',
      { max_external: 50, max_marks: 100 },
      { subject_type: 'lab' }
    );

    // SGPA cannot divide by zero — backfill NULL/0 credits with scheme default
    await queryInterface.bulkUpdate('subjects',
      { credits: 4 },
      { credits: null }
    );
    await queryInterface.bulkUpdate('subjects',
      { credits: 4 },
      { credits: 0 }
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('subjects', 'max_marks');
    await queryInterface.removeColumn('subjects', 'max_external');
    await queryInterface.removeColumn('subjects', 'max_internal');
    // credits backfill intentionally NOT reversed (real data improvement)
  }
};
