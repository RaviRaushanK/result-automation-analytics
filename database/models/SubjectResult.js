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
    internal_marks: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    external_marks: {
      type: DataTypes.INTEGER,
      allowNull: true
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
    tableName: 'subject_results',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['result_id', 'subject_id']
      }
    ]
  });
};
