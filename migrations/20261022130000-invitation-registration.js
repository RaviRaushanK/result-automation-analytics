'use strict';
module.exports = {
  async up(q, S) {
    const columns = await q.describeTable('admin_users');
    for (const name of ['email_verified_at', 'mobile_verified_at']) {
      if (!columns[name]) await q.addColumn('admin_users', name, { type: S.DATE, allowNull: true });
    }
    await q.createTable('account_invitations', {
      id: { type: S.CHAR(36), primaryKey: true },
      token_hash: { type: S.CHAR(64), allowNull: false, unique: true },
      email: { type: S.STRING(100), allowNull: false },
      invited_by: { type: S.BIGINT, allowNull: false, references: { model: 'admin_users', key: 'admin_id' } },
      expires_at: { type: S.DATE, allowNull: false },
      accepted_at: { type: S.DATE, allowNull: true },
      revoked_at: { type: S.DATE, allowNull: true },
      registration: { type: S.JSON, allowNull: true },
      created_at: { type: S.DATE, allowNull: false }
    });
  },
  async down() { throw new Error('Registration audit data is retained; restore a verified backup to roll back.'); }
};
