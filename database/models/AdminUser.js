module.exports = (sequelize, DataTypes) => {
  return sequelize.define('AdminUser', {
    admin_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    admin_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    mobile: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    password_hash: {
      // Passwords are stored only as bcrypt hashes.
      type: DataTypes.STRING(255),
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('admin', 'faculty'),
      defaultValue: 'admin'
    },
    faculty_id: { type: DataTypes.BIGINT, allowNull: true, unique: true },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    },
    last_login: {
      type: DataTypes.DATE
    },
    email_verified_at: { type: DataTypes.DATE, allowNull: true },
    // Legacy storage only; account phone entry and verification are retired.
    mobile_verified_at: { type: DataTypes.DATE, allowNull: true },
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
    tableName: 'admin_users'
  });
};
