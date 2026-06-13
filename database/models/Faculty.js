module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Faculty', {
    faculty_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    faculty_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    department_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    faculty_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true
    },
    faculty_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(100),
      unique: true
    },
    designation: {
      type: DataTypes.STRING(100)
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
    paranoid: true,
    tableName: 'faculty'
  });
};