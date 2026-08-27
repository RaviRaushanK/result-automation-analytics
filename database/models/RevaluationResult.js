module.exports = (sequelize, DataTypes) => {
  return sequelize.define('RevaluationResult', {
    revaluation_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    subject_result_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    original_marks: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    revised_marks: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    original_status: {
      type: DataTypes.ENUM('pass', 'fail'),
      allowNull: false
    },
    revised_status: {
      type: DataTypes.ENUM('pass', 'fail'),
      allowNull: false
    },
    revised_grade: {
      type: DataTypes.STRING(5)
    },
    revaluation_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Sequence of revaluation events for this subject result (history preserved)'
    },
    is_effective: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Exactly one event per subject_result_id feeds effective results'
    },
    reviewed_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Admin who approved/rejected this revaluation event'
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    revaluation_status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending'
    },
    file_name: {
      type: DataTypes.STRING(255)
    },
    file_path: {
      type: DataTypes.STRING(255)
    },
    remarks: {
      type: DataTypes.TEXT
    },
    uploaded_by: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    upload_date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'revaluation_results',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['subject_result_id', 'revaluation_no'],
        name: 'unique_reval_event'
      },
      {
        fields: ['subject_result_id'],
        name: 'idx_reval_subject_result'
      }
    ]
  });
};