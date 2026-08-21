module.exports = async ({ sequelize, DataTypes }) => {
  const AdminUser = require('../database/models/AdminUser')(sequelize, DataTypes);
  const bcrypt = require('bcryptjs');

  try {
    // check if admin already exists
    const existing = await AdminUser.findOne({
      where: { email: 'admin@example.com' }
    });

    if (existing) {
      console.log('Admin already exists. Skipping creation.');
      return;
    }

    // create password hash
    const password_hash = await bcrypt.hash('admin123', 10);

    // create admin user
    await AdminUser.create({
      admin_uuid: '00000000-0000-0000-0000-000000000001',
      username: 'admin',
      email: 'admin@example.com',
      password_hash,
      role: 'admin',
      status: 'active'
    });

    console.log('Default admin created successfully.');

  } catch (err) {
    console.error('Error creating admin:', err);
  }
};