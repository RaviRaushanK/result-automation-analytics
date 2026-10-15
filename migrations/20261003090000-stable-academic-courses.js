'use strict';

const definitionFields = ['subject_name', 'subject_type', 'credits', 'max_internal', 'max_external', 'max_marks'];
function mappingGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const semester = String(Number(row.semester));
    const code = String(row.subject_code).trim().toUpperCase();
    const key = JSON.stringify([String(row.batch_id), semester, code]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, semester, subject_code: code });
  }
  return [...groups.values()].map(group => ({ rows: group, ambiguous: new Set(group.map(row => JSON.stringify(definitionFields.map(field => row[field])))).size !== 1 }));
}
module.exports = {
  mappingGroups,
  async up(q, S) {
    const tables = await q.showAllTables();
    if (!tables.includes('academic_courses')) await q.createTable('academic_courses', {
      course_id: { type: S.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      batch_id: { type: S.BIGINT, allowNull: false, references: { model: 'batches', key: 'batch_id' }, onDelete: 'RESTRICT' },
      semester: { type: S.STRING(20), allowNull: false },
      subject_code: { type: S.STRING(20), allowNull: false },
      subject_name: { type: S.STRING(100), allowNull: false },
      subject_type: { type: S.ENUM('theory','lab','project'), allowNull: false },
      credits: { type: S.INTEGER, allowNull: false },
      max_internal: { type: S.INTEGER, allowNull: false }, max_external: { type: S.INTEGER, allowNull: false }, max_marks: { type: S.INTEGER, allowNull: false },
      grading_scheme_version: { type: S.STRING(40), allowNull: true },
      is_required: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
      roster_verified: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      reviewed_by: { type: S.BIGINT, allowNull: true, references: { model: 'admin_users', key: 'admin_id' }, onDelete: 'RESTRICT' },
      reviewed_at: { type: S.DATE, allowNull: true },
      status: { type: S.ENUM('active','inactive'), allowNull: false, defaultValue: 'active' },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') }
    });
    const indexes = await q.showIndex('academic_courses');
    if (!indexes.some(index => index.name === 'unique_academic_course')) await q.addIndex('academic_courses', ['batch_id','semester','subject_code'], { unique: true, name: 'unique_academic_course' });
    const subjectColumns = await q.describeTable('subjects');
    if (!subjectColumns.course_id) await q.addColumn('subjects', 'course_id', { type: S.BIGINT, allowNull: true, references: { model: 'academic_courses', key: 'course_id' }, onDelete: 'RESTRICT' });
    const additions = {
      results: { sgpa_source: { type: S.STRING(30), allowNull: false, defaultValue: 'LEGACY' }, cgpa_source: { type: S.STRING(30), allowNull: false, defaultValue: 'LEGACY' }, cgpa_is_cumulative: { type: S.BOOLEAN, allowNull: false, defaultValue: false }, grading_scheme_version: { type: S.STRING(40), allowNull: true } },
      subject_results: { grading_scheme_version: { type: S.STRING(40), allowNull: true }, grade_point: { type: S.DECIMAL(4,2), allowNull: true }, credits_snapshot: { type: S.INTEGER, allowNull: true }, course_id_snapshot: { type: S.BIGINT, allowNull: true, references: { model: 'academic_courses', key: 'course_id' }, onDelete: 'RESTRICT' } }
    };
    for (const [table, fields] of Object.entries(additions)) {
      const columns = await q.describeTable(table);
      for (const [name, options] of Object.entries(fields)) if (!columns[name]) await q.addColumn(table, name, options);
    }
    // MySQL DDL commits implicitly. Only the additive mapping DML is transactional.
    await q.sequelize.transaction(async transaction => {
      const rows = await q.sequelize.query('SELECT s.*,rs.batch_id,rs.semester FROM subjects s JOIN result_sessions rs ON rs.session_id=s.session_id ORDER BY s.subject_id', { type: S.QueryTypes.SELECT, transaction });
      const groups = mappingGroups(rows);
      const regular = await q.sequelize.query("SELECT DISTINCT rs.batch_id,rs.semester,r.session_id FROM results r JOIN result_sessions rs ON rs.session_id=r.session_id WHERE r.exam_type='REGULAR'", { type: S.QueryTypes.SELECT, transaction });
      const conflicting = new Set();
      const rosters = new Map();
      for (const sitting of regular) {
        const key = `${sitting.batch_id}:${Number(sitting.semester)}`;
        const codes = rows.filter(row => String(row.session_id) === String(sitting.session_id)).map(row => row.subject_code.trim().toUpperCase()).sort().join('|');
        if (rosters.has(key) && rosters.get(key) !== codes) conflicting.add(key);
        rosters.set(key, codes);
      }
      for (const group of groups) {
        if (group.ambiguous) { console.warn('Unmapped conflicting academic course:', group.rows.map(row => row.subject_id)); continue; }
        const row = group.rows[0];
        if (!/^\d+$/.test(String(row.semester)) || Number(row.semester) < 1 || definitionFields.some(field => row[field] === null)) { console.warn('Unmapped incomplete subject:', row.subject_id); continue; }
        await q.sequelize.query(`INSERT IGNORE INTO academic_courses (batch_id,semester,subject_code,subject_name,subject_type,credits,max_internal,max_external,max_marks,roster_verified)
          VALUES (:batch_id,:semester,:subject_code,:subject_name,:subject_type,:credits,:max_internal,:max_external,:max_marks,:verified)`, { replacements: { ...row, verified: rosters.has(`${row.batch_id}:${row.semester}`) && !conflicting.has(`${row.batch_id}:${row.semester}`) }, transaction });
        const [course] = await q.sequelize.query('SELECT * FROM academic_courses WHERE batch_id=:batch_id AND semester=:semester AND subject_code=:subject_code', { replacements: row, type: S.QueryTypes.SELECT, transaction });
        if (!course || definitionFields.some(field => String(course[field]) !== String(row[field]))) continue;
        for (const offering of group.rows) await q.sequelize.query('UPDATE subjects SET course_id=:course_id WHERE subject_id=:subject_id AND course_id IS NULL', { replacements: { course_id: course.course_id, subject_id: offering.subject_id }, transaction });
      }
      for (const key of conflicting) console.warn('Semester course roster requires explicit review:', key);
    });
  },
  async down() { throw new Error('Academic history migration is intentionally irreversible; restore a verified backup for rollback.'); }
};
