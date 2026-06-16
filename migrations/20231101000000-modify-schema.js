'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Drop global unique on subjects.subject_code
    await queryInterface.removeConstraint('subjects', 'subjects_subject_code_key').catch(() => {});
    // Add composite unique on subjects
    await queryInterface.addConstraint('subjects', {
      fields: ['session_id', 'subject_code'],
      type: 'unique',
      name: 'unique_session_subject_code'
    });

    // Add composite unique on result_sessions
    await queryInterface.addConstraint('result_sessions', {
      fields: ['batch_id', 'semester', 'exam_session', 'exam_year'],
      type: 'unique',
      name: 'unique_session_batch'
    });

    // Alter results sgpa and cgpa to allow NULL
    await queryInterface.changeColumn('results', 'sgpa', {
      type: Sequelize.DECIMAL(3,2),
      allowNull: true
    });
    await queryInterface.changeColumn('results', 'cgpa', {
      type: Sequelize.DECIMAL(3,2),
      allowNull: true
    });

    // Add new columns to revaluation_results
    await queryInterface.addColumn('revaluation_results', 'revised_grade', {
      type: Sequelize.STRING(5),
      allowNull: true
    });
    await queryInterface.addColumn('revaluation_results', 'file_name', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('revaluation_results', 'file_path', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('revaluation_results', 'remarks', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('revaluation_results', 'uploaded_by', {
      type: Sequelize.BIGINT,
      allowNull: true,
      references: {
        model: 'admin_users',
        key: 'admin_id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  }
};
