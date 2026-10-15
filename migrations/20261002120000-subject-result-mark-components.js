'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('subject_results');
    for (const name of ['internal_marks', 'external_marks']) {
      if (!columns[name]) await queryInterface.addColumn('subject_results', name, {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: 'Original validated mark component; NULL for historical imports'
      });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('subject_results', 'external_marks');
    await queryInterface.removeColumn('subject_results', 'internal_marks');
  }
};
