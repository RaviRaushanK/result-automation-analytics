'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        'UPDATE students SET student_name = UPPER(TRIM(student_name)) WHERE BINARY student_name <> BINARY UPPER(TRIM(student_name))',
        { transaction }
      );
    });
  },
  async down() {
    throw new Error('Original student name capitalization cannot be recovered; normalization rollback is not supported.');
  }
};
