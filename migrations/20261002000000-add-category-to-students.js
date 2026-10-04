'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add category column to students table only.
    const desc = await queryInterface.describeTable('students');
    if (!desc.category) {
      await queryInterface.addColumn('students', 'category', {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null
      });
    }
    try {
      await queryInterface.addIndex('students', ['category'], {
        name: 'idx_student_category'
      });
    } catch (e) { /* index may already exist */ }
  },

  down: async (queryInterface) => {
    try {
      await queryInterface.removeIndex('students', 'idx_student_category');
    } catch (e) { /* ignore */ }
    const desc = await queryInterface.describeTable('students');
    if (desc.category) {
      await queryInterface.removeColumn('students', 'category');
    }
  }
};
