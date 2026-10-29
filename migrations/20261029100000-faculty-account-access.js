'use strict';
module.exports = {
  async up(q, S) {
    await q.changeColumn('admin_users', 'role', { type: S.ENUM('admin', 'faculty'), defaultValue: 'admin' });
    const accounts = await q.describeTable('admin_users');
    if (!accounts.faculty_id) await q.addColumn('admin_users', 'faculty_id', {
      type: S.BIGINT, allowNull: true, unique: true,
      references: { model: 'faculty', key: 'faculty_id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE'
    });
    const invitations = await q.describeTable('account_invitations');
    if (!invitations.faculty_id) await q.addColumn('account_invitations', 'faculty_id', {
      type: S.BIGINT, allowNull: true,
      references: { model: 'faculty', key: 'faculty_id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE'
    });
    await q.sequelize.query('UPDATE account_invitations SET revoked_at = CURRENT_TIMESTAMP, registration = NULL WHERE faculty_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL');
  },
  async down() { throw new Error('Faculty accounts and invitation audit data must be retained; restore a verified backup to roll back.'); }
};
