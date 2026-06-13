module.exports = async ({ sequelize, DataTypes }) => {
  const SystemSetting = require('../database/models/SystemSetting')(sequelize, DataTypes);

  const defaults = [
    { setting_key: 'OCR_CONFIDENCE_THRESHOLD', setting_value: '0.85' },
    { setting_key: 'PASS_PERCENTAGE_RULE', setting_value: '40' },
    { setting_key: 'AI_MODEL_NAME', setting_value: 'gpt-4' }
  ];

  for (const setting of defaults) {
    await SystemSetting.findOrCreate({
      where: { setting_key: setting.setting_key },
      defaults: { setting_value: setting.setting_value }
    });
  }
};