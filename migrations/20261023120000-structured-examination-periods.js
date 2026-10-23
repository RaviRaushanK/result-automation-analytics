'use strict';

const period = require('../public/js/exam-period');

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('result_sessions');
    for (const [name, definition] of Object.entries({
      exam_start_month: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      exam_start_year: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      exam_end_month: { type: Sequelize.TINYINT.UNSIGNED, allowNull: true },
      exam_end_year: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true }
    })) if (!table[name]) await queryInterface.addColumn('result_sessions', name, definition);

    const [sessions] = await queryInterface.sequelize.query(
      'SELECT session_id, exam_session, exam_year, exam_start_month, exam_start_year, exam_end_month, exam_end_year FROM result_sessions ORDER BY session_id'
    );
    for (const session of sessions) {
      const structured = period.normalize({
        exam_start_month: session.exam_start_month,
        exam_start_year: session.exam_start_year,
        exam_end_month: session.exam_end_month,
        exam_end_year: session.exam_end_year
      });
      if (structured) continue;
      const legacy = period.normalize({ exam_session: session.exam_session, exam_year: session.exam_year });
      if (!legacy) throw new Error(`Cannot safely migrate ResultSession ${session.session_id}: invalid legacy examination month/year.`);
      await queryInterface.sequelize.query(
        'UPDATE result_sessions SET exam_start_month=?, exam_start_year=?, exam_end_month=?, exam_end_year=? WHERE session_id=?',
        { replacements: [legacy.exam_start_month, legacy.exam_start_year, legacy.exam_end_month, legacy.exam_end_year, session.session_id] }
      );
    }
    for (const [name, type] of [['exam_start_month', Sequelize.TINYINT.UNSIGNED], ['exam_start_year', Sequelize.SMALLINT.UNSIGNED],
      ['exam_end_month', Sequelize.TINYINT.UNSIGNED], ['exam_end_year', Sequelize.SMALLINT.UNSIGNED]]) {
      await queryInterface.changeColumn('result_sessions', name, { type, allowNull: false });
    }
    await queryInterface.removeConstraint('result_sessions', 'unique_session_batch').catch(() => {});
    await queryInterface.addConstraint('result_sessions', { type: 'unique', name: 'unique_session_exam_period',
      fields: ['batch_id', 'semester', 'exam_start_month', 'exam_start_year', 'exam_end_month', 'exam_end_year'] });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('result_sessions', 'unique_session_exam_period').catch(() => {});
    await queryInterface.addConstraint('result_sessions', { type: 'unique', name: 'unique_session_batch',
      fields: ['batch_id', 'semester', 'exam_session', 'exam_year'] });
    for (const name of ['exam_end_year', 'exam_end_month', 'exam_start_year', 'exam_start_month']) {
      await queryInterface.removeColumn('result_sessions', name);
    }
  }
};
