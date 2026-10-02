'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const outcomes=require('../services/academicOutcomeService');
const policy=require('../services/academicPolicy');
const db=require('../database/models');
after(()=>db.sequelize.close());

function history(failedSemester=null,retakeStatus='pass',retakeType='BACKLOG') {
  const courses=[1,2,3,4].map(n=>({course_id:n,semester:String(n),status:'active',is_required:true,roster_verified:true}));
  const results=[],subjects=[];
  for(const semester of [1,2]) {
    const r={student_id:1,result_id:semester,session_id:semester,semester:String(semester),exam_type:'REGULAR',attempt_no:1,exam_session:semester===1?'Dec':'Jun',exam_year:semester===1?2025:2026};
    results.push(r);subjects.push({...r,course_id:semester,outcome_status:semester===failedSemester?'fail':'pass'});
  }
  if(failedSemester) {
    const r={student_id:1,result_id:10,session_id:10,semester:String(failedSemester),exam_type:retakeType,attempt_no:1,exam_session:'Dec',exam_year:2026};
    results.push(r);subjects.push({...r,course_id:failedSemester,outcome_status:retakeStatus});
  }
  return {courses,results,subjects};
}
const year=data=>outcomes.academicYearOutcome(data,1,['1','2']);
test('Both semesters passed first attempt: First Year N/Y',()=>assert.deepEqual(year(history()),{withBacklog:'N',withoutBacklog:'Y',cleared:true}));
for(const semester of [1,2])for(const type of policy.RETAKE_TYPES)test(`Semester ${semester} cleared through ${type}: First Year Y/N`,()=>{
  assert.deepEqual(year(history(semester,'pass',type)),{withBacklog:'Y',withoutBacklog:'N',cleared:true});
});
test('Failed retake with both semester histories known: First Year N/N',()=>assert.deepEqual(year(history(1,'fail')),{withBacklog:'N',withoutBacklog:'N',cleared:false}));
test('Future Second Year and partially reached year remain unavailable, even with known failures',()=>{
  const data=history(1,'fail');assert.deepEqual(outcomes.academicYearOutcome(data,1,['3','4']),{withBacklog:'-',withoutBacklog:'-',cleared:null});
  data.results=data.results.filter(r=>r.semester!=='2');data.subjects=data.subjects.filter(r=>r.semester!=='2');
  assert.equal(year(data).withBacklog,'-');assert.equal(year(data).withoutBacklog,'-');
});
test('Unverified, incomplete and unknown-status history never invents completion',()=>{
  for(const mutate of [d=>{d.courses[0].roster_verified=false;},d=>{d.subjects[0].outcome_status=null;},d=>{d.subjects.shift();},d=>{d.results[0].exam_session='Unknown';}]) {
    const data=history();mutate(data);assert.deepEqual(year(data),{withBacklog:'-',withoutBacklog:'-',cleared:null});
  }
});
test('A later REGULAR pass is not fabricated backlog clearance',()=>{
  assert.deepEqual(year(history(1,'pass','REGULAR')),{withBacklog:'-',withoutBacklog:'-',cleared:true});
  const data=history(1,'pass','REGULAR');
  const unnecessary={...data.results.at(-1),result_id:11,session_id:11,exam_type:'BACKLOG',exam_session:'Jun',exam_year:2027};
  data.results.push(unnecessary);data.subjects.push({...unnecessary,course_id:1,outcome_status:'pass'});
  assert.equal(year(data).withBacklog,'-','A retake after an accepted regular pass was not required for clearance');
});
test('Revaluation-selected canonical status is used without changing original history',()=>{
  const original=history(1,'fail');const effective=structuredClone(original);
  effective.subjects.find(s=>s.result_id===10).outcome_status='pass';
  assert.equal(year(original).withBacklog,'N');assert.equal(year(effective).withBacklog,'Y');
  const regularRevision=structuredClone(original);regularRevision.subjects[0].outcome_status='pass';
  assert.equal(year(regularRevision).withoutBacklog,'Y');
  const passToFail=history();passToFail.subjects[0].outcome_status='fail';
  assert.deepEqual(year(passToFail),{withBacklog:'N',withoutBacklog:'N',cleared:false});
});
test('Year groups use complete semester pairs dynamically, without inventing a fixed duration',()=>{
  assert.deepEqual(policy.academicYearGroups(['1','2','3','4']).map(y=>[y.label,y.semesters]),[['First Year',['1','2']],['Second Year',['3','4']]]);
  assert.deepEqual(policy.academicYearGroups(['3']).map(y=>y.semesters),[['1','2'],['3','4']]);
  assert.equal(policy.academicYearGroups(['10']).length,5);
  assert.deepEqual(policy.academicYearGroups([]),[]);
  assert.equal(policy.academicYearGroups(['0','25','invalid']).length,0);
});
test('Persisted Progress year completion, Original/Effective overlay and CSV share one dataset',{skip:process.env.DEMO_SEED_DB_TEST!=='1'},async()=>{
  const service=require('../services/reportsService');
  const batch=await db.Batch.findOne({where:{batch_name:'MCA 2025'}});
  const original=await service.getReport('student-progress',{batch_id:String(batch.batch_id),mode:'original',pageSize:'100'});
  const effective=await service.getReport('student-progress',{batch_id:String(batch.batch_id),mode:'effective',pageSize:'100'});
  assert.deepEqual(original.academicYears.map(y=>y.label),['First Year','Second Year']);
  const pair=(report,usn,n=1)=>{const r=report.rows.find(r=>r.usn===usn);return[r[`year_${n}_with_backlog`],r[`year_${n}_without_backlog`]];};
  for(const suffix of ['061','011'])assert.deepEqual(pair(original,`1MV25MC${suffix}`),['N','Y']);
  for(const suffix of ['052','002','004','005','009','017'])assert.deepEqual(pair(original,`1MV25MC${suffix}`),['Y','N']);
  assert.deepEqual(pair(original,'1MV25MC003'),['N','N']);
  assert.deepEqual(pair(original,'1MV25MC074'),['N','N']);assert.deepEqual(pair(effective,'1MV25MC074'),['N','Y']);
  for(const suffix of ['006','007'])assert.deepEqual(pair(effective,`1MV25MC${suffix}`),pair(original,`1MV25MC${suffix}`));
  assert.deepEqual(pair(effective,'1MV25MC016'),['Y','N']);
  assert.deepEqual(pair(effective,'1MV25MC015'),['N','N']);
  for(const row of original.rows)assert.deepEqual(pair(original,row.usn,2),['-','-'],'Semester 4 is future');
  assert.deepEqual(pair(original,'1MV25MC025'),['-','-']);
  const unknownBatch=await db.Batch.findOne({where:{batch_name:'TEST UNVERIFIED MCA'}});
  const unknown=await service.getReport('student-progress',{batch_id:String(unknownBatch.batch_id)});
  for(const r of unknown.rows)assert.equal(r.year_1_with_backlog,'-');
  assert.ok(original.columns.some(c=>c.label==='Successfully Completed With Back Log - First Year'));
  assert.ok(!original.columns.some(c=>/^Sem \d+ (With|Without) Backlog/.test(c.label)));
});
