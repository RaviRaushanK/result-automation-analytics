'use strict';
const bcrypt = require('bcryptjs');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const passwordHash = await bcrypt.hash('admin123', 10);

    await queryInterface.bulkInsert('admin_users', [
      {
        admin_uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        username: 'admin',
        email: 'admin@sraas.edu',
        password_hash: passwordHash,
        role: 'super_admin',
        status: 'active',
        last_login: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('admin_users', { username: 'admin' });
  }
};
