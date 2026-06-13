module.exports = (sequelize, DataTypes) => {
  return sequelize.define('Subject', {
    subject_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    subject_uuid: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true
    },
    session_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    subject_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true
    },
    subject_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    subject_type: {
      type: DataTypes.ENUM('theory', 'lab', 'project'),
      allowNull: false
    },
    credits: {
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
    tableName: 'subjects', // IMPORTANT
    timestamps: false
  });
};