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
      allowNull: false
    },
    // Composite unique index (session_id, subject_code)
    // Sequelize will enforce this via the indexes array below
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
    max_internal: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 50,
      comment: 'Maximum internal/CIE marks'
    },
    max_external: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 50,
      comment: 'Maximum external/SEE marks'
    },
    max_marks: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100,
      comment: 'Maximum total marks; grade % computed against this'
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
    tableName: 'subjects',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['session_id', 'subject_code'],
        name: 'unique_session_subject_code'
      }
    ]
  });
};