'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('students');
    if (!columns.category) await queryInterface.addColumn('students', 'category', {
      type: Sequelize.STRING(30), allowNull: true, defaultValue: null,
      comment: 'Manually recorded admission category; NULL when unknown'
    });
  },
  async down(queryInterface) { await queryInterface.removeColumn('students', 'category'); }
};
