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
    grading_scheme_version: { type: DataTypes.STRING(40), allowNull: true },
    grade_point: { type: DataTypes.DECIMAL(4,2), allowNull: true },
    credits_snapshot: { type: DataTypes.INTEGER, allowNull: true },
    course_id_snapshot: { type: DataTypes.BIGINT, allowNull: true },
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
