'use strict';
const fields = ['revised_internal_marks', 'revised_external_marks'];
function view(components) {
  return `CREATE OR REPLACE VIEW effective_student_results AS
    SELECT rr.result_id,rr.student_id,rr.exam_session_id,srs.subject_id,
      COALESCE(eff.revised_marks,srs.marks) AS effective_marks,
      COALESCE(eff.revised_grade,srs.grade) AS effective_grade,
      rr.result_status,rr.cgpa,rr.sgpa,rr.failed_subject_count,rr.created_at
      ${components ? `,COALESCE(eff.revised_internal_marks,srs.internal_marks) AS effective_internal_marks,
      COALESCE(eff.revised_external_marks,srs.external_marks) AS effective_external_marks,
      COALESCE(eff.revised_marks,srs.marks) AS effective_total_marks,
      COALESCE(eff.revised_status,srs.result_status) AS effective_result` : ''}
    FROM results rr JOIN subject_results srs ON rr.result_id=srs.result_id
    LEFT JOIN revaluation_results eff ON eff.subject_result_id=srs.subject_result_id
      AND eff.is_effective=1 AND eff.revaluation_status='approved'
      AND eff.revaluation_no=(SELECT MAX(pick.revaluation_no) FROM revaluation_results pick
        WHERE pick.subject_result_id=srs.subject_result_id AND pick.is_effective=1 AND pick.revaluation_status='approved')`;
}
module.exports = {
  async up(q, Sequelize) {
    const schema = await q.describeTable('revaluation_results');
    for (const name of fields) if (schema[name]) throw new Error('Component column already exists: inspect migration state before retrying.');
    for (const name of fields) await q.addColumn('revaluation_results', name, { type: Sequelize.INTEGER, allowNull: true, defaultValue: null });
    await q.sequelize.query(view(true));
  },
  async down(q) {
    const [rows] = await q.sequelize.query('SELECT COUNT(*) AS used FROM revaluation_results WHERE revised_internal_marks IS NOT NULL OR revised_external_marks IS NOT NULL');
    if (Number(rows[0].used)) throw new Error('Rollback refused: revised component evidence exists. Export/preserve it through a controlled migration first.');
    await q.sequelize.query(view(false));
    for (const name of [...fields].reverse()) await q.removeColumn('revaluation_results', name);
  }
};
