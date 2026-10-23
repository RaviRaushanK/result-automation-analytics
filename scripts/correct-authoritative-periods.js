'use strict';
// One-time, explicitly authorized correction. No ordinary editor bypass.
const db = require('../database/models');
const crypto = require('crypto');
const fs = require('fs');
const period = require('../public/js/exam-period');
const assert = require('node:assert/strict');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const tables = ['students', 'results', 'subject_results', 'revaluation_results'];
async function query(sql, transaction, replacements) {
  return (await db.sequelize.query(sql, { transaction, replacements }))[0];
}
async function snapshot(transaction) {
  const out = {};
  for (const table of tables) {
    const rows = await query(`SELECT * FROM ${table} ORDER BY 1`, transaction);
    out[table] = { count: rows.length, sha256: digest(JSON.stringify(rows)) };
  }
  return out;
}
async function counts(id, t) {
  const [row] = await query(`SELECT
    (SELECT COUNT(*) FROM results WHERE exam_session_id=:id) results,
    (SELECT COUNT(*) FROM subjects WHERE exam_session_id=:id) subjects,
    (SELECT COUNT(*) FROM import_logs WHERE exam_session_id=:id) imports,
    (SELECT COUNT(*) FROM subject_results sr JOIN results r ON r.result_id=sr.result_id WHERE r.exam_session_id=:id) sr,
    (SELECT COUNT(*) FROM revaluation_results rv JOIN subject_results sr ON sr.subject_result_id=rv.subject_result_id JOIN results r ON r.result_id=sr.result_id WHERE r.exam_session_id=:id) rv,
    (SELECT COUNT(*) FROM subject_faculty sf JOIN subjects s ON s.subject_id=sf.subject_id WHERE s.exam_session_id=:id) faculty`, t, { id });
  return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v)]));
}
function checkSession(row, id, sem, key) {
  assert.ok(row, `Missing session ${id}`);
  assert.equal(Number(row.exam_session_id), id); assert.equal(Number(row.batch_id), 1);
  assert.equal(Number(row.semester), sem); assert.equal(period.key(row), key);
}
async function audit(t, actor, action) {
  assert.ok(action.length <= 255);
  await query('INSERT INTO activity_logs (admin_id,activity,ip_address,created_at) VALUES (:actor,:action,:source,CURRENT_TIMESTAMP)', t,
    { actor, action, source: 'maintenance' });
}
async function correct(id, sem, expected, target, expectedResults, actor, consolidate) {
  return db.sequelize.transaction(async t => {
    const [admin] = await query('SELECT admin_id FROM admin_users WHERE admin_id=:actor AND role=\'admin\' AND status=\'active\' AND deleted_at IS NULL FOR UPDATE',t,{actor});
    assert.ok(admin, 'Authorized administrator is unavailable');
    const sessions = await query('SELECT * FROM exam_sessions ORDER BY exam_session_id FOR UPDATE',t);
    const current = sessions.find(s=>Number(s.exam_session_id)===id);
    checkSession(current,id,sem,expected);
    const [batch] = await query('SELECT batch_name FROM batches WHERE batch_id=1 FOR UPDATE',t);
    assert.equal(batch.batch_name,'MCA 2025');
    const before = await snapshot(t), baseline = await counts(id,t);
    assert.equal(baseline.results,expectedResults);
    const untouched = sessions.filter(s=>Number(s.exam_session_id)!==id && (!consolidate || Number(s.exam_session_id)!==5));
    const conflicts=sessions.filter(s=>Number(s.batch_id)===1 && Number(s.semester)===sem && period.key(s)===period.key(target));
    if (consolidate) {
      assert.equal(conflicts.length,1); assert.equal(Number(conflicts[0].exam_session_id),5);
      checkSession(conflicts[0],5,1,'2025-12-2026-1');
      assert.deepEqual(baseline,{results:10,subjects:6,imports:44,sr:60,rv:1,faculty:6});
      assert.deepEqual(await counts(5,t),{results:0,subjects:2,imports:1,sr:0,rv:0,faculty:0});
      const offerings=await query('SELECT * FROM subjects WHERE exam_session_id=5 ORDER BY subject_id FOR UPDATE',t);
      assert.equal(offerings.length,2);
      for(const [index,s] of offerings.entries()) {
        const expected={subject_id:22+index,exam_session_id:5,course_id:1+index,subject_code:['MMC101','MMC102'][index],subject_name:['PROGRAMMING AND PROBLEM SOLVING IN C','DISCRETE MATHEMATICS AND GRAPH THEORY'][index],subject_type:'theory',credits:[4,3][index],max_internal:50,max_external:50,max_marks:100};
        for(const [key,value] of Object.entries(expected)) assert.equal(s[key],value,`Offering ${s.subject_id} ${key} changed`);
        const original=(await query('SELECT * FROM subjects WHERE subject_id=:id FOR UPDATE',t,{id:index+1}))[0];
        for(const key of ['course_id','subject_code','subject_name','subject_type','credits','max_internal','max_external','max_marks']) assert.equal(s[key],original[key]);
        assert.equal((await query('SELECT subject_result_id FROM subject_results WHERE subject_id=:id FOR UPDATE',t,{id:s.subject_id})).length,0);
        assert.equal((await query('SELECT subject_id FROM subject_faculty WHERE subject_id=:id FOR UPDATE',t,{id:s.subject_id})).length,0);
      }
      const allExtractions=await db.OcrExtraction.findAll({transaction:t,lock:true});
      function checkReferences(value) {
        if(!value || typeof value!=='object') return;
        for(const [key,v] of Object.entries(value)) {
          if(['subject_id','subjectId'].includes(key)) assert.ok(![22,23].includes(Number(v)),'Persisted extraction references cleanup offering');
          if(typeof v==='object') checkReferences(v);
        }
      }
      allExtractions.forEach(e=>checkReferences(typeof e.extracted_json==='string'?JSON.parse(e.extracted_json):e.extracted_json));
      const log=await db.ImportLog.findByPk(85,{transaction:t,lock:true});
      const extraction=await db.OcrExtraction.findByPk(82,{transaction:t,lock:true});
      assert.ok(log && extraction); assert.equal(Number(log.exam_session_id),5);
      assert.equal(log.status,'extracted'); assert.equal(log.import_type,'ORIGINAL');
      assert.equal(log.imported_records,0); assert.equal(log.total_records,0);
      assert.equal(Number(extraction.import_id),85); assert.equal(extraction.validation_status,'pending');
      assert.equal(allExtractions.filter(e=>Number(e.import_id)===85).length,1);
      const evidence=typeof extraction.extracted_json==='string'?JSON.parse(extraction.extracted_json):extraction.extracted_json;
      assert.equal(evidence.student.usn,'1MV25MC025'); assert.equal(evidence.attempt.exam_type,'REGULAR'); assert.equal(evidence.attempt.attempt_no,1);
      assert.equal(evidence.subjects.length,0); assert.equal(evidence.excluded_subjects.length,6);
      const originalJson=JSON.stringify(evidence), raw=extraction.raw_text;
      const hash=digest(fs.readFileSync(log.file_path));
      assert.equal(hash,'32acd86a0ab1b65a136a6219cfc49712bc58fa6913e55cee441ffb9769b554f6');
      const reference=await db.ImportLog.findByPk(83,{transaction:t,lock:true});
      assert.equal(Number(reference.exam_session_id),1); assert.equal(digest(fs.readFileSync(reference.file_path)),hash);
      await audit(t,actor,'historical_import_session_reassociation import=85 old_session=5 old_period=Dec 2025/Jan 2026 new_session=1 current_period=Apr 2026; Preserve unfinished duplicate-session import provenance before historical session-period correction. source=maintenance');
      await log.update({exam_session_id:1},{transaction:t});
      await extraction.update({extracted_json:{...evidence,review_token:null,configuration_snapshot:null},validation_status:'pending'},{transaction:t});
      const refreshed=await db.OcrExtraction.findByPk(82,{transaction:t});
      assert.equal(refreshed.raw_text,raw);
      const restored={...refreshed.extracted_json}; delete restored.review_token; delete restored.configuration_snapshot;
      const expectedEvidence={...JSON.parse(originalJson)}; delete expectedEvidence.review_token; delete expectedEvidence.configuration_snapshot;
      assert.deepEqual(restored,expectedEvidence); assert.equal(digest(fs.readFileSync(log.file_path)),hash);
      for(const s of offerings) {
        await audit(t,actor,`historical_duplicate_offering_cleanup subject=${s.subject_id} session=5 course=${s.course_id} code=${s.subject_code}; name=${s.subject_name}; type=theory credits=${s.credits} maxima=50/50/100; reason=unused duplicate of session 1; source=maintenance`);
        await query('DELETE FROM subjects WHERE subject_id=:id AND exam_session_id=5',t,{id:s.subject_id});
      }
      assert.deepEqual(await counts(5,t),{results:0,subjects:0,imports:0,sr:0,rv:0,faculty:0});
      await query('DELETE FROM exam_sessions WHERE exam_session_id=5',t);
      await audit(t,actor,'historical_duplicate_session_cleanup session=5 period=Dec 2025/Jan 2026; import=85 extraction=82 source preserved under session=1; zero academic dependencies; source=maintenance');
    } else assert.equal(conflicts.length,0,'Target period conflict');
    await query('UPDATE exam_sessions SET exam_start_month=:exam_start_month,exam_start_year=:exam_start_year,exam_end_month=:exam_end_month,exam_end_year=:exam_end_year,exam_session=:legacy,exam_year=:year,updated_at=updated_at WHERE exam_session_id=:id',t,
      {...target,id,legacy:period.MONTHS[target.exam_start_month-1],year:target.exam_start_year});
    await audit(t,actor,`historical_session_period_correction session=${id} old=${period.format(current)} new=${period.format(target)} dependent_results=${expectedResults}; Authoritative VTU examination-period correction. No Result/SR/Revaluation rows modified; source=maintenance`);
    assert.deepEqual(await snapshot(t),before,'Academic checksum changed: rollback');
    for(const row of untouched) assert.deepEqual((await query('SELECT * FROM exam_sessions WHERE exam_session_id=:id',t,{id:row.exam_session_id}))[0],row);
    const after=await counts(id,t); assert.equal(after.results,expectedResults);
    const [mismatch]=await query('SELECT COUNT(*) count FROM subject_results sr JOIN results r ON r.result_id=sr.result_id JOIN subjects s ON s.subject_id=sr.subject_id WHERE r.exam_session_id<>s.exam_session_id',t);
    assert.equal(Number(mismatch.count),0);
    return {id,old:period.format(current),new:period.format(target),before,after,baseline,sourcePreserved:consolidate};
  });
}
async function main() {
  assert.equal(process.argv[2],'--execute-authorized-admin-1','Explicit one-time execution flag required');
  const first=await correct(1,1,'2026-4-2026-4',{exam_start_month:12,exam_start_year:2025,exam_end_month:1,exam_end_year:2026},10,1,true);
  console.log(JSON.stringify({committed:first},null,2));
  const second=await correct(2,2,'2026-7-2026-7',{exam_start_month:5,exam_start_year:2026,exam_end_month:6,exam_end_year:2026},8,1,false);
  console.log(JSON.stringify({committed:second},null,2));
}
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.sequelize.close());
