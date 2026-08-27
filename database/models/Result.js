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
    session_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    sgpa: {
      type: DataTypes.DECIMAL(4,2),
      allowNull: true
    },
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
      comment: 'Attempt number for this student+session; 1 = first sitting. No schema-level cap.'
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