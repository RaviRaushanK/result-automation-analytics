module.exports = (sequelize, DataTypes) => {
  return sequelize.define('batch', {
    batch_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    batch_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    department_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    batch_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    start_year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    end_year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    deleted_at: {
      type: DataTypes.DATE
    }
  }, {
    timestamps: false,
    paranoid: true
  });
};