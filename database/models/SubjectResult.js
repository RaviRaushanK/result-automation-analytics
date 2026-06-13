module.exports = (sequelize, DataTypes) => {
  return sequelize.define('SubjectResult', {
    subject_result_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    result_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    subject_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    marks: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    grade: {
      type: DataTypes.STRING(5)
    },
    result_status: {
      type: DataTypes.ENUM('pass', 'fail'),
      allowNull: false
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['result_id', 'subject_id']
      }
    ]
  });
};