'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const [conflicts] = await queryInterface.sequelize.query(
        'SELECT UPPER(TRIM(usn)) AS normalized_usn FROM students GROUP BY UPPER(TRIM(usn)) HAVING COUNT(*) > 1',
        { transaction }
      );
      if (conflicts.length) throw new Error('Resolve duplicate normalized student USNs before running this migration.');
      await queryInterface.sequelize.query(
        'UPDATE students SET usn = UPPER(TRIM(usn)) WHERE BINARY usn <> BINARY UPPER(TRIM(usn))',
        { transaction }
      );
    });
  },
  async down() {
    throw new Error('Original USN capitalization cannot be recovered; normalization rollback is not supported.');
  }
};
