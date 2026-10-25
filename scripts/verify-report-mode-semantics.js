'use strict';

// Read-only live verification. Requires one exact existing attempt, and never
// starts the app, creates a session, migrates, seeds, or persists a report.
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const { sequelize } = require('../database/models');
const reports = require('../services/reportsService');
const controller = require('../controllers/reportsController');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) =>
    value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
  if (!args.usn || !args.subject || !/^[1-9][0-9]*$/.test(args['result-id'] || ''))
    throw new Error('Use --usn USN --subject CODE --result-id ID for one exact attempt.');
  const select = sequelize.query.bind(sequelize);
  sequelize.query = (sql, options) => {
    assert.match(sql.trim(), /^SELECT\b/i, 'Live verification is read-only');
    return select(sql, options);
  };
  const snapshot = async () => {
    const [rows] = await sequelize.query(`SELECT st.student_id,st.usn,st.batch_id,r.result_id,r.exam_session_id,r.attempt_no,r.exam_type,r.sgpa,r.cgpa,rs.semester,
      sr.subject_result_id,sr.subject_id,sr.internal_marks,sr.external_marks,sr.marks,sr.grade,sr.result_status,
      v.effective_internal_marks,v.effective_external_marks,v.effective_total_marks,v.effective_grade,v.effective_result
      FROM students st JOIN results r ON r.student_id=st.student_id JOIN exam_sessions rs ON rs.exam_session_id=r.exam_session_id
      JOIN subject_results sr ON sr.result_id=r.result_id JOIN subjects sub ON sub.subject_id=sr.subject_id
      JOIN effective_student_results v ON v.result_id=r.result_id AND v.subject_id=sr.subject_id
      WHERE st.usn=:usn AND sub.subject_code=:subject AND r.result_id=:resultId`,
    { replacements: { usn: args.usn, subject: args.subject, resultId: Number(args['result-id']) } });
    assert.equal(rows.length, 1, 'Resolve one exact subject/attempt');
    const [events] = await sequelize.query('SELECT * FROM revaluation_results WHERE subject_result_id=:id ORDER BY revaluation_no',
      { replacements: { id: rows[0].subject_result_id } });
    return { original: rows[0], events };
  };
  const before = await snapshot(), original = before.original;
  let passed = 0;
  for (const mode of ['original', 'effective']) {
    const raw = mode === 'original' ? [original.internal_marks, original.external_marks, original.marks]
      : [original.effective_internal_marks, original.effective_external_marks, original.effective_total_marks];
    const expected = raw.map(value => value == null ? null : Number(value));
    const active = before.events.some(event => event.revaluation_status === 'approved' && Number(event.is_effective) === 1);
    if (mode === 'effective' && active && (expected.some(value => value === null) || expected[0] + expected[1] !== expected[2]))
      expected[0] = expected[1] = null;
    for (const type of ['student', 'subject', 'consolidated']) {
      const query = { batch_id: String(original.batch_id), semester: String(original.semester), exam_session_id: String(original.exam_session_id), mode,
        ...(type === 'student' ? { student_id: String(original.student_id), attempt_no: String(original.attempt_no) } : type === 'subject' ? { subject_id: String(original.subject_id) } : {}) };
      const report = await reports.getReport(type, query);
      const find = rows => rows.find(row => row.usn === args.usn && (type === 'consolidated' || Number(row.subject_id) === Number(original.subject_id)));
      const row = find(report.rows); assert.ok(row);
      const keys = type === 'consolidated' ? ['IA', 'EX', 'T'].map(part => `subject_${original.subject_id}_${part}`)
        : ['internal_marks', 'external_marks', 'marks'];
      const values = row => keys.map(key => row[key] == null ? null : Number(row[key]));
      assert.deepEqual(values(row), expected);
      if (type === 'consolidated') assert.equal(row.sgpa == null ? null : Number(row.sgpa), original.sgpa == null ? null : Number(original.sgpa));
      else {
        assert.equal(row.result_status, mode === 'original' ? original.result_status : original.effective_result);
        assert.equal(row.grade, mode === 'original' ? original.grade : original.effective_grade);
      }
      passed++;
      const response = { text: '', set() {}, write(text) { this.text += text; return true; }, end() {},
        status() { throw new Error('Export failed'); }, json(value) { throw new Error(JSON.stringify(value)); } };
      await controller.csv(type)({ query }, response);
      const lines = response.text.split(/\r?\n/), line = lines.find(line => type === 'student'
        ? line.includes(',' + args.subject + ',') : line.includes(',' + args.usn + ','));
      assert.ok(line); const cells = line.split(',');
      const csv = type === 'consolidated' ? keys.map(key => cells[report.columns.findIndex(column => column.key === key) + 1])
        : ['IA', 'External', 'Total'].map(key => cells[lines.find(line => line.startsWith('Sl. No.,')).split(',').indexOf(key)]);
      assert.deepEqual(csv, expected.map(value => value == null ? '' : String(value))); passed++;
      let locals;
      await controller.print(type)({ query }, { render(view, value) { locals = value; },
        status() { throw new Error('Print failed'); }, json(value) { throw new Error(JSON.stringify(value)); } });
      const html = await ejs.renderFile(path.join(__dirname, '../views/reports/print.ejs'), locals);
      assert.ok(html.includes(args.subject)); assert.ok(html.includes('Generated at'));
      assert.deepEqual(values(find(locals.report.rows)), expected); passed++;
      console.log(`${type} ${mode}: IA ${expected[0]}, EX ${expected[1]}, Total ${expected[2]}`);
    }
  }
  assert.deepEqual(await snapshot(), before, 'Original components, stored GPA and source events remain unchanged');
  console.log(`Live parity: passed ${passed}, failed 0, skipped 0, exit code 0. Academic source snapshot unchanged.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => sequelize.close());
