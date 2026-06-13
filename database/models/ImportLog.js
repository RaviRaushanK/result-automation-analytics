module.exports = (sequelize, DataTypes) => {
  return sequelize.define('import_log', {
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
      type: DataTypes.ENUM('success', 'failed'),
      defaultValue: 'success'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false
  });
};