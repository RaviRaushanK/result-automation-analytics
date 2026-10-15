'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('setting_audits', {
      audit_id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      setting_key: { type: Sequelize.STRING(100), allowNull: false },
      old_value: { type: Sequelize.STRING(255), allowNull: true },
      new_value: { type: Sequelize.STRING(255), allowNull: false },
      changed_by: { type: Sequelize.BIGINT, allowNull: false },
      changed_at: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('setting_audits', ['changed_at', 'audit_id'], { name: 'setting_audits_chronology' });
  },
  async down() { throw new Error('Settings audit history is retained; destructive rollback is not supported.'); }
};
