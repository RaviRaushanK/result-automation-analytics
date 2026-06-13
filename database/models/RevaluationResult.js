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
    revaluation_status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending'
    },
    upload_date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false,
    tableName: 'revaluation_results'
  });
};