'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const [conflicts] = await queryInterface.sequelize.query(
        'SELECT LOWER(TRIM(email)) AS normalized_email FROM students WHERE email IS NOT NULL GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1',
        { transaction }
      );
      if (conflicts.length) throw new Error('Resolve duplicate normalized student emails before running this migration.');
      await queryInterface.sequelize.query(
        'UPDATE students SET email = LOWER(TRIM(email)) WHERE BINARY email <> BINARY LOWER(TRIM(email))',
        { transaction }
      );
    });
  },
  async down() {
    throw new Error('Original email capitalization cannot be recovered; normalization rollback is not supported.');
  }
};
