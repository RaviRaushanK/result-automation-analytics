module.exports = (sequelize, DataTypes) => {
  return sequelize.define('ImportLog', {
    import_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    session_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    uploaded_by: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    file_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    file_path: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    file_type: {
      type: DataTypes.ENUM('pdf', 'jpg', 'jpeg', 'png'),
      allowNull: false
    },
    import_type: {
      type: DataTypes.ENUM('ORIGINAL', 'REVALUATION'),
      allowNull: false,
      defaultValue: 'ORIGINAL',
      comment: 'Which upload flow produced this log entry'
    },
    total_records: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    imported_records: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    skipped_records: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('pending', 'extracted', 'success', 'failed'),
      defaultValue: 'pending'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false,
    tableName: 'import_logs'
  });
};