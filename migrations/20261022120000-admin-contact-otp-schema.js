'use strict';

// Existing installations may already have run scripts/apply-schema.js.
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('admin_users');
    if (!columns.mobile) {
      await queryInterface.addColumn('admin_users', 'mobile', {
        type: Sequelize.STRING(20), allowNull: true, after: 'email'
      });
    }

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS admin_otps (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        admin_id BIGINT NOT NULL,
        otp_hash VARCHAR(255) NOT NULL,
        type ENUM('password_reset','email_change','mobile_change') NOT NULL,
        target_value VARCHAR(255) NULL,
        expires_at DATETIME NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        is_used TINYINT(1) NOT NULL DEFAULT 0,
        resend_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES admin_users(admin_id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    const indexes = await queryInterface.showIndex('admin_otps');
    for (const [name, fields] of [
      ['idx_admin_otps_admin_type', ['admin_id', 'type']],
      ['idx_admin_otps_expires', ['expires_at']]
    ]) {
      if (!indexes.some(index => index.name === name)) {
        await queryInterface.addIndex('admin_otps', fields, { name });
      }
    }
  },
  async down() {
    throw new Error('Contact information and OTP history are retained; restore a verified backup to roll back.');
  }
};
