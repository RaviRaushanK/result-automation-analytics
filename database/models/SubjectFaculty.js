module.exports = (sequelize, DataTypes) => {
  return sequelize.define('subject_faculty', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    subject_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    faculty_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['subject_id', 'faculty_id']
      }
    ]
  });
};