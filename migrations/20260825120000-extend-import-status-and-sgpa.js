'use strict';

/**
 * Extends the result-upload page flow:
 *  1. import_logs.status gains intermediate workflow states
 *     ('pending' = uploaded/processing, 'extracted' = waiting for admin review)
 *  2. results.sgpa / results.cgpa widen from DECIMAL(3,2) to DECIMAL(4,2)
 *     so a perfect SGPA of 10.00 no longer overflows the column.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1) Wider status workflow on import_logs.
    //    Existing rows only contain 'success' | 'failed', which remain valid.
    await queryInterface.changeColumn('import_logs', 'status', {
      type: Sequelize.ENUM('pending', 'extracted', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending'
    });

    // 2) SGPA / CGPA can reach 10.00 -> needs DECIMAL(4,2). Docs already treat
    //    these as nullable, so preserve NULL-ability while widening precision.
    await queryInterface.changeColumn('results', 'sgpa', {
      type: Sequelize.DECIMAL(4, 2),
      allowNull: true
    });
    await queryInterface.changeColumn('results', 'cgpa', {
      type: Sequelize.DECIMAL(4, 2),
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Collapse workflow states that cannot exist in the old narrow enum,
    // otherwise the column shrink itself fails with truncation errors.
    await queryInterface.bulkUpdate('import_logs',
      { status: 'failed' },
      { status: ['pending', 'extracted'] }
    );

    await queryInterface.changeColumn('import_logs', 'status', {
      type: Sequelize.ENUM('success', 'failed'),
      allowNull: false,
      defaultValue: 'success'
    });

    await queryInterface.changeColumn('results', 'sgpa', {
      type: Sequelize.DECIMAL(3, 2),
      allowNull: true
    });
    await queryInterface.changeColumn('results', 'cgpa', {
      type: Sequelize.DECIMAL(3, 2),
      allowNull: true
    });
  }
};
