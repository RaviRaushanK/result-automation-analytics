module.exports = (sequelize, DataTypes) => {
  return sequelize.define('ExamSession', {
    exam_session_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    session_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    batch_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    semester: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    exam_session: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    exam_year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    exam_start_month: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, validate: { min: 1, max: 12 } },
    exam_start_year: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, validate: { min: 1900, max: 2200 } },
    exam_end_month: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, validate: { min: 1, max: 12 } },
    exam_end_year: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, validate: { min: 1900, max: 2200 } },
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
      tableName: 'exam_sessions',
      validate: {
        chronologicalExaminationPeriod() {
          if ((this.exam_end_year * 12 + this.exam_end_month) < (this.exam_start_year * 12 + this.exam_start_month)) {
            throw new Error('Examination end period cannot be before its start period.');
          }
        }
      },
      indexes: [
        {
          unique: true,
          fields: ['batch_id', 'semester', 'exam_start_month', 'exam_start_year', 'exam_end_month', 'exam_end_year'],
          name: 'unique_session_exam_period'
        }
      ]
    });
};
