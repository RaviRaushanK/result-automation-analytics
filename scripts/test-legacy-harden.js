/** Temporary test: legacy POST/PUT /results hardening. Cleans up all rows. */
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const db = require('../database/models');
const { Result, ResultSession, Subject, Student, sequelize } = db;
const rc = require('../controllers/resultController');

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  PASS:', n); } else { fail++; console.log('  FAIL:', n); } };

function call(fn, req) {
  return new Promise((resolve, reject) => {
    let statusCode = null, json = null;
    const res = { status(c) { statusCode = c; return this; }, json(o) { json = o; resolve({ status: statusCode, json }); }, send() { resolve({ status: statusCode, json }); } };
    try { const m = fn(req, res); if (m && m.catch) m.catch(reject); } catch (e) { reject(e); }
  });
}

(async () => {
  const created = { results: [], students: [], sessions: [], subjectIds: {}, batch: null };
  try {
    const batch = await db.Batch.create({ batch_uuid: crypto.randomUUID(), department_id: 1, batch_name: '__SEC_TEST__', start_year: 2025, end_year: 2026, status: 'active' });
    created.batch = batch;

    let n = 0;
    async function freshContext() {
      n++;
      const session = await ResultSession.create({ session_uuid: crypto.randomUUID(), batch_id: batch.batch_id, semester: 'Semester SEC ' + n, exam_session: 'MAY', exam_year: 2026 });
      created.sessions.push(session);
      const stu = await Student.create({ student_uuid: crypto.randomUUID(), batch_id: batch.batch_id, usn: 'SEC-T-' + String(1000 + n), student_name: 'Sec Test', status: 'active' });
      created.students.push(stu);
      return { session, stu };
    }

    console.log('[POST] legitimate create');
    const { session: s1, stu: u1 } = await freshContext();
    const legit = await call(rc.create, { body: { student_id: u1.student_id, session_id: s1.session_id, sgpa: 8.5, cgpa: 8.5, result_status: 'pass', failed_subject_count: 0 } });
    check('legit POST returns 201', legit.status === 201);
    check('legit POST attempt_no=1 forced', legit.json && legit.json.attempt_no === 1);
    check('legit POST exam_type=REGULAR forced', legit.json && legit.json.exam_type === 'REGULAR');
    if (legit.json) created.results.push(legit.json);

    console.log('[POST] mass-assignment blocked');
    const { session: s2, stu: u2 } = await freshContext();
    const mal = await call(rc.create, { body: { student_id: u2.student_id, session_id: s2.session_id, attempt_no: 999, exam_type: 'REPEAT', sgpa: 6, cgpa: 6, result_status: 'pass', failed_subject_count: 0 } });
    check('malicious POST 201', mal.status === 201);
    check('client attempt_no=999 ignored -> 1', mal.json && mal.json.attempt_no === 1);
    check('client exam_type=REPEAT ignored -> REGULAR', mal.json && mal.json.exam_type === 'REGULAR');
    if (mal.json) created.results.push(mal.json);

    console.log('[POST] result_uuid ignored');
    const { session: s3, stu: u3 } = await freshContext();
    const crafted = '00000000-0000-0000-0000-00000000DEAD';
    const uu = await call(rc.create, { body: { student_id: u3.student_id, session_id: s3.session_id, result_uuid: crafted, sg: 6, cg: 6, result_status: 'fail', failed_subject_count: 3 } });
    check('client result_uuid ignored', uu.json && uu.json.result_uuid !== crafted);
    check('result_uuid is v4', uu.json && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uu.json.result_uuid));
    if (uu.json) created.results.push(uu.json);

    console.log('[PUT] attempt_no/exam_type immutable');
    const target = created.results[0];
    await call(rc.update, { params: { id: target.result_id }, body: { attempt_no: 999, exam_type: 'REPEAT', sgpa: 9.9 } });
    const after = await Result.findByPk(target.result_id);
    check('PUT client attempt_no ignored', Number(after.attempt_no) === 1);
    check('PUT client exam_type ignored', after.exam_type === 'REGULAR');
    check('PUT allowed field applied (sgpa=9.9)', Number(after.sgpa) === 9.9);

    console.log('[DB] constraints intact');
    const idx = await sequelize.query("SHOW INDEX FROM results WHERE Key_name='unique_student_session_attempt'", { type: sequelize.QueryTypes.SELECT });
    check('unique_student_session_attempt present', idx.length >= 3);

    console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  } catch (e) {
    console.error('TEST ERROR:', e.message);
  } finally {
    for (const r of created.results) { try { await Result.destroy({ where: { result_id: r.result_id } }); } catch (_) {} }
    for (const s of created.sessions) { try { await Subject.destroy({ where: { session_id: s.session_id } }); } catch (_) {} }
    for (const s of created.sessions) { try { await ResultSession.destroy({ where: { session_id: s.session_id } }); } catch (_) {} }
    for (const u of created.students) { try { await Student.destroy({ where: { student_id: u.student_id } }); } catch (_) {} }
    if (created.batch) { try { await db.Batch.destroy({ where: { batch_id: created.batch.batch_id } }); } catch (_) {} }
    try { await sequelize.close(); } catch (_) {}
    console.log('Cleanup complete.');
    process.exit(fail === 0 ? 0 : 1);
  }
})();