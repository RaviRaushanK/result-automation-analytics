module.exports = async ({ sequelize, DataTypes }) => {
  const AdminUser = require('../database/models/AdminUser')(sequelize, DataTypes);
  const bcrypt = require('bcryptjs');

  // Create a super admin if none exists
  const [admin, created] = await AdminUser.findOrCreate({
    where: { username: 'superadmin' },
    defaults: {
      admin_uuid: '00000000-0000-0000-0000-000000000001',
      email: 'admin@example.com',
      password_hash: await bcrypt.hash('ChangeMe123!', 10),
      role: 'super_admin',
      status: 'active'
    }
  });

  if (created) {
    console.log('Default super admin created.');
  }
};