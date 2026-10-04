const emailValidation = require('../../public/js/student-email-validation');

module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Student', {
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
    category: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: null,
      validate: { len: [1, 30] }
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        validStudentEmail(value) {
          const error = emailValidation.getError(value);
          if (error) throw new Error(error);
        }
      }
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true
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
      tableName: 'students',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
      paranoid: true
  });
};
