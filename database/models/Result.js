module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Result', {
    result_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    result_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    student_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    exam_session_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    sgpa: {
      type: DataTypes.DECIMAL(4,2),
      allowNull: true
    },
    sgpa_source: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'LEGACY' },
    cgpa_source: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'LEGACY' },
    cgpa_is_cumulative: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    grading_scheme_version: { type: DataTypes.STRING(40), allowNull: true },
    cgpa: {
      type: DataTypes.DECIMAL(4,2),
      allowNull: true
    },
    result_status: {
      type: DataTypes.ENUM('pass', 'fail'),
      allowNull: false
    },
    failed_subject_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    attempt_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Student semester attempt across sessions: REGULAR 1, BACKLOG 2 onward. Historical numbers are preserved.'
    },
    exam_type: {
      type: DataTypes.ENUM('REGULAR', 'BACKLOG', 'SUPPLEMENTARY', 'REPEAT'),
      allowNull: false,
      defaultValue: 'REGULAR',
      comment: 'Kind of exam participation this result belongs to'
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
    tableName: 'results'
  });
};
