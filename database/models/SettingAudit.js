module.exports = (sequelize, DataTypes) => sequelize.define('SettingAudit', {
  audit_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  setting_key: { type: DataTypes.STRING(100), allowNull: false },
  old_value: { type: DataTypes.STRING(255), allowNull: true },
  new_value: { type: DataTypes.STRING(255), allowNull: false },
  changed_by: { type: DataTypes.BIGINT, allowNull: false },
  changed_at: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'setting_audits', timestamps: false });
