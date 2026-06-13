module.exports = (sequelize, DataTypes) => {
  return sequelize.define('SystemSetting', {
    setting_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    setting_key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    setting_value: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'system_settings',
    timestamps: false,
    freezeTableName: true
  });
};