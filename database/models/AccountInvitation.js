module.exports = (sequelize, D) => sequelize.define('AccountInvitation', {
  id: { type: D.CHAR(36), primaryKey: true },
  token_hash: { type: D.CHAR(64), allowNull: false },
  email: { type: D.STRING(100), allowNull: false },
  invited_by: { type: D.BIGINT, allowNull: false },
  expires_at: { type: D.DATE, allowNull: false },
  accepted_at: D.DATE,
  revoked_at: D.DATE,
  registration: D.JSON,
  created_at: { type: D.DATE, allowNull: false }
}, { tableName: 'account_invitations', timestamps: false });
