module.exports = (sequelize, DataTypes) => {
  return sequelize.define('student', {
    student_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    student_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    batch_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    usn: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    student_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(100),
      unique: true
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