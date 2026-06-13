module.exports = (sequelize, DataTypes) => {
  return sequelize.define('result_session', {
    session_id: {
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
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false
  });
};