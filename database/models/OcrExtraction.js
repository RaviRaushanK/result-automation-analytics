module.exports = (sequelize, DataTypes) => {
  return sequelize.define('ocr_extraction', {
    extraction_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    import_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    raw_text: {
      type: DataTypes.TEXT
    },
    extracted_json: {
      type: DataTypes.JSON
    },
    confidence_score: {
      type: DataTypes.DECIMAL(5,2),
      defaultValue: 0.00
    },
    validation_status: {
      type: DataTypes.ENUM('pending', 'validated', 'rejected'),
      defaultValue: 'pending'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    timestamps: false
  });
};