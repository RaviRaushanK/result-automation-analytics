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
      type: DataTypes.DECIMAL(3,2),
      allowNull: false
    },
    cgpa: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: false
    },
    result_status: {
      type: DataTypes.ENUM('pass', 'fail'),
      allowNull: false
    },
    failed_subject_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
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