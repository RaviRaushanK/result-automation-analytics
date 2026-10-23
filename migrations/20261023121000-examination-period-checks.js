'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint('result_sessions', {
      type: 'check', name: 'result_sessions_start_month_check',
      fields: ['exam_start_month'],
      where: { exam_start_month: { [queryInterface.sequelize.Sequelize.Op.between]: [1, 12] } }
    });
    await queryInterface.addConstraint('result_sessions', {
      type: 'check', name: 'result_sessions_end_month_check',
      fields: ['exam_end_month'],
      where: { exam_end_month: { [queryInterface.sequelize.Sequelize.Op.between]: [1, 12] } }
    });
    await queryInterface.sequelize.query(
      'ALTER TABLE result_sessions ADD CONSTRAINT result_sessions_period_order_check CHECK ((exam_end_year * 12 + exam_end_month) >= (exam_start_year * 12 + exam_start_month))'
    );
  },

  async down(queryInterface) {
    for (const name of ['result_sessions_period_order_check', 'result_sessions_end_month_check', 'result_sessions_start_month_check']) {
      await queryInterface.removeConstraint('result_sessions', name);
    }
  }
};
