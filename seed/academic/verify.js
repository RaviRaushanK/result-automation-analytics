'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const data=require('./data');
const policy=require('../../services/academicPolicy');
const outcomes=require('../../services/academicOutcomeService');
async function inspect(db,transaction) {
  const rows={};
  for(const name of ['Batch','Student','AcademicCourse','ResultSession','Subject','Result','SubjectResult','RevaluationResult','Faculty','SubjectFaculty'])rows[name]=await db[name].findAll({raw:true,transaction});
  return rows;
}
function references(rows) {
  const by=(list,id)=>new Map(list.map(r=>[String(r[id]),r]));
  return {batches:by(rows.Batch,'batch_id'),students:by(rows.Student,'student_id'),sessions:by(rows.ResultSession,'session_id'),
    courses:by(rows.AcademicCourse,'course_id'),subjects:by(rows.Subject,'subject_id'),results:by(rows.Result,'result_id'),subjectResults:by(rows.SubjectResult,'subject_result_id'),faculty:by(rows.Faculty,'faculty_id')};
}
function logicalDigest(rows) {
  const ref=references(rows);
  const resultKey=r=>r.result_uuid;
  const subjectKey=r=>r.subject_uuid;
  const courseKey=c=>`${ref.batches.get(String(c.batch_id)).batch_name}:${c.semester}:${c.subject_code}`;
  const sorted=list=>list.sort((a,b)=>a.key.localeCompare(b.key));
  const payload={
    students:sorted(rows.Student.map(r=>({key:r.usn,name:r.student_name,email:r.email,batch:ref.batches.get(String(r.batch_id)).batch_name,category:r.category}))),
    courses:sorted(rows.AcademicCourse.map(r=>({key:courseKey(r),credits:r.credits,max:r.max_marks,name:r.subject_name,verified:Number(r.roster_verified),scheme:r.grading_scheme_version}))),
    subjects:sorted(rows.Subject.map(r=>({key:subjectKey(r),course:courseKey(ref.courses.get(String(r.course_id))),session:ref.sessions.get(String(r.session_id)).session_uuid}))),
    results:sorted(rows.Result.map(r=>({key:resultKey(r),usn:ref.students.get(String(r.student_id)).usn,session:ref.sessions.get(String(r.session_id)).session_uuid,
      type:r.exam_type,attempt:r.attempt_no,sgpa:r.sgpa==null?null:Number(r.sgpa),cgpa:r.cgpa==null?null:Number(r.cgpa),sgpa_source:r.sgpa_source,cgpa_source:r.cgpa_source,cumulative:Number(r.cgpa_is_cumulative),status:r.result_status,failed:r.failed_subject_count}))),
    marks:sorted(rows.SubjectResult.map(r=>({key:`${resultKey(ref.results.get(String(r.result_id)))}:${subjectKey(ref.subjects.get(String(r.subject_id)))}`,
      ia:r.internal_marks,ex:r.external_marks,total:r.marks,grade:r.grade,status:r.result_status,points:r.grade_point==null?null:Number(r.grade_point),credits:r.credits_snapshot,scheme:r.grading_scheme_version}))),
    revaluation:sorted(rows.RevaluationResult.map(r=>{const sr=ref.subjectResults.get(String(r.subject_result_id));return{key:`${resultKey(ref.results.get(String(sr.result_id)))}:${subjectKey(ref.subjects.get(String(sr.subject_id)))}:${r.revaluation_no}`,
      status:r.revaluation_status,effective:Number(r.is_effective),old:r.original_marks,revised:r.revised_marks,old_status:r.original_status,revised_status:r.revised_status,grade:r.revised_grade};})),
    staff:sorted(rows.SubjectFaculty.map(r=>({key:`${subjectKey(ref.subjects.get(String(r.subject_id)))}:${ref.faculty.get(String(r.faculty_id)).faculty_code}`})))
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
async function verify(db,transaction) {
  const plan=data.plan();const rows=await inspect(db,transaction);const ref=references(rows);
  assert.equal(rows.Student.length,36,'Exactly 36 demo identities');
  const distinct=(list,key)=>assert.equal(new Set(list.map(key)).size,list.length,'Duplicate logical identity');
  distinct(rows.Student,r=>r.usn);distinct(rows.AcademicCourse,r=>`${r.batch_id}:${r.semester}:${r.subject_code}`);
  distinct(rows.ResultSession,r=>`${r.batch_id}:${r.semester}:${r.exam_session}:${r.exam_year}`);
  distinct(rows.Result,r=>`${r.student_id}:${r.session_id}:${r.attempt_no}`);
  distinct(rows.RevaluationResult,r=>`${r.subject_result_id}:${r.revaluation_no}`);
  for(const identity of data.REAL_STUDENTS){const matches=rows.Student.filter(s=>s.usn===identity.usn);assert.equal(matches.length,1);assert.equal(matches[0].student_name,identity.name);assert.equal(matches[0].email,identity.email);}
  for(const student of rows.Student.filter(s=>!data.REAL_STUDENTS.some(real=>real.usn===s.usn))){assert.match(student.student_name,/^DEMO /);assert.match(student.email,/@example\.com$/);}
  assert.equal(rows.AcademicCourse.length,48);assert.equal(rows.ResultSession.length,12);assert.equal(rows.Subject.length,72);
  assert.equal(rows.Result.length,plan.results.length);assert.equal(rows.RevaluationResult.length,plan.revaluations.length);
  for(const subject of rows.Subject){
    const course=ref.courses.get(String(subject.course_id)),session=ref.sessions.get(String(subject.session_id));
    assert.ok(course);assert.equal(String(course.batch_id),String(session.batch_id));assert.equal(course.semester,session.semester);
    for(const field of ['subject_code','subject_name','subject_type','credits','max_internal','max_external','max_marks'])assert.equal(String(subject[field]),String(course[field]));
    if(ref.batches.get(String(course.batch_id)).batch_name!=='TEST UNVERIFIED MCA')assert.equal(Number(course.roster_verified),1);
  }
  const states={};
  for(const batch of plan.batches){const row=rows.Batch.find(b=>b.batch_name===batch.name);assert.ok(row);const ids=rows.Student.filter(s=>String(s.batch_id)===String(row.batch_id)).map(s=>s.student_id);
    states[batch.key]={original:await outcomes.load(row.batch_id,ids,'original',transaction),effective:await outcomes.load(row.batch_id,ids,'effective',transaction)};
  }
  for(const header of rows.Result){
    const marks=rows.SubjectResult.filter(sr=>String(sr.result_id)===String(header.result_id));
    const session=ref.sessions.get(String(header.session_id)),student=ref.students.get(String(header.student_id));
    const sessionSpec=plan.sessions.find(s=>data.uuid(s.key)===session.session_uuid);
    const spec=plan.results.find(r=>r.usn===student.usn&&r.session===sessionSpec.key&&r.attempt_no===header.attempt_no);
    assert.ok(spec);assert.equal(marks.length,Object.keys(spec.values).length,'No invented retake rows');
    const failed=marks.filter(sr=>sr.result_status==='fail').length;
    assert.equal(header.failed_subject_count,failed);assert.equal(header.result_status,failed?'fail':'pass');
    for(const sr of marks){
      const subject=ref.subjects.get(String(sr.subject_id));assert.equal(String(subject.session_id),String(header.session_id));
      assert.ok(sr.marks>0&&sr.marks<=subject.max_marks);
      const expected=policy.gradeFromPercent(Math.floor(sr.marks*100/subject.max_marks));assert.equal(sr.grade,expected.grade);assert.equal(sr.result_status,expected.status);
      if(sr.internal_marks!==null&&sr.external_marks!==null){assert.equal(sr.internal_marks+sr.external_marks,sr.marks);assert.ok(sr.internal_marks>=0&&sr.internal_marks<=subject.max_internal);assert.ok(sr.external_marks>=0&&sr.external_marks<=subject.max_external);}
      else assert.ok(student.usn==='1MV25MC012'&&sessionSpec.key==='p1'&&subject.subject_code==='MMC101','Only the explicit historical fixture lacks components');
      if(sessionSpec.batch!=='unknown'){assert.equal(sr.grading_scheme_version,policy.SCHEME);assert.equal(Number(sr.grade_point),expected.point);assert.equal(sr.credits_snapshot,subject.credits);assert.equal(String(sr.course_id_snapshot),String(subject.course_id));}
    }
    if(policy.isRegularAttempt(header.exam_type)){
      assert.equal(marks.length,data.courses(Number(session.semester)).length,'Full regular roster');
      if(sessionSpec.batch!=='unknown'){
        const credits=marks.reduce((sum,sr)=>sum+Number(sr.credits_snapshot),0);
        const expected=Number((marks.reduce((sum,sr)=>sum+Number(sr.grade_point)*sr.credits_snapshot,0)/credits).toFixed(2));
        assert.equal(Number(header.sgpa),expected);assert.equal(header.sgpa_source,'CALCULATED');
      }
    }else assert.equal(header.sgpa,null,'Retake SGPA remains unavailable');
    const original=states[sessionSpec.batch].original;
    const published={...original,results:original.results.filter(r=>BigInt(r.result_id)<=BigInt(header.result_id)),subjects:original.subjects.filter(sr=>BigInt(sr.result_id)<=BigInt(header.result_id))};
    const expected=outcomes.cumulative(published,header.student_id,session.semester,policy.period(session));
    assert.equal(header.cgpa===null?null:Number(header.cgpa),expected,'Cumulative snapshot follows existing service at publication');
    assert.equal(Number(header.cgpa_is_cumulative),expected===null?0:1);
  }
  for(const event of rows.RevaluationResult){const sr=ref.subjectResults.get(String(event.subject_result_id));assert.equal(event.original_marks,sr.marks);assert.equal(event.original_status,sr.result_status);assert.equal(event.revised_status,policy.gradeFromPercent(Math.floor(event.revised_marks*100/ref.subjects.get(String(sr.subject_id)).max_marks)).status);if(event.revaluation_status!=='approved')assert.equal(Number(event.is_effective),0);}
  const effective=rows.RevaluationResult.filter(r=>Number(r.is_effective));distinct(effective,r=>r.subject_result_id);
  const check=(usn,semester,mode,first,sup,cleared)=>{const person=rows.Student.find(s=>s.usn===usn);const batch=plan.students.find(s=>s.usn===usn).batch;
    const actual=outcomes.semesterOutcome(states[batch][mode],person.student_id,String(semester));assert.equal(actual.firstAttempt,first,usn);assert.equal(actual.supplementaryPass,sup,usn);assert.equal(actual.cleared,cleared,usn);return actual;};
  for(const semester of [1,2,3])check('1MV25MC061',semester,'original','P','-',true);
  check('1MV25MC052',1,'original','F','P',true);check('1MV25MC002',1,'original','F','P',true);
  check('1MV25MC003',1,'original','F','F',false);const multiple=check('1MV25MC004',1,'original','F','P',true);
  assert.equal(multiple.courses[2].attempts.length,3);check('1MV25MC005',1,'original','F','P',true);check('1MV25MC017',1,'original','F','P',true);
  for(const semester of [1,2,3])check('1MV25MC009',semester,'original',semester===2?'F':'P',semester===2?'P':'-',true);
  check('1MV25MC074',1,'original','F','-',false);check('1MV25MC074',1,'effective','P','-',true);
  check('1MV25MC008',1,'original','F','-',false);check('1MV25MC008',1,'effective','P','-',true);
  for(const suffix of ['006','007'])for(const mode of ['original','effective'])check(`1MV25MC${suffix}`,1,mode,'F','-',false);
  check('1MV25MC015',1,'original','P','-',true);check('1MV25MC015',1,'effective','F','-',false);
  check('1MV25MC016',1,'original','F','F',false);check('1MV25MC016',1,'effective','F','P',true);
  for(const usn of ['1MV24MC901','1MV24MC902']){check(usn,1,'original','-','-',null);const person=rows.Student.find(s=>s.usn===usn);assert.equal(outcomes.cumulative(states.unknown.original,person.student_id,1),null);}
  const ravi=rows.Student.find(s=>s.usn==='1MV25MC061');assert.equal(outcomes.cumulative(states.primary.original,ravi.student_id,3),10);
  const normal=rows.Student.find(s=>s.usn==='1MV25MC001');assert.equal(outcomes.cumulative(states.primary.original,normal.student_id,3),8.16,'Cumulative GPA differs from the latest semester SGPA');
  const praful=rows.Student.find(s=>s.usn==='1MV25MC052');
  const history=rows.SubjectResult.filter(sr=>String(ref.results.get(String(sr.result_id)).student_id)===String(praful.student_id)&&ref.subjects.get(String(sr.subject_id)).subject_code==='MMC103');
  assert.equal(history.length,2);assert.notEqual(String(history[0].subject_id),String(history[1].subject_id));
  assert.equal(String(ref.subjects.get(String(history[0].subject_id)).course_id),String(ref.subjects.get(String(history[1].subject_id)).course_id),'Cross-session offerings resolve to the same stable course');
  const future=check('1MV25MC026',3,'original','-','-',null);assert.equal(future.firstRegularResult,null);
  const counts={students:rows.Student.length,courses:rows.AcademicCourse.length,sessions:rows.ResultSession.length,subjects:rows.Subject.length,subjectResults:rows.SubjectResult.length,
    results:Object.fromEntries(policy.EXAM_TYPES.map(type=>[type,rows.Result.filter(r=>r.exam_type===type).length])),
    revaluations:Object.fromEntries(['approved','pending','rejected'].map(status=>[status,rows.RevaluationResult.filter(r=>r.revaluation_status===status).length]))};
  return {counts,digest:logicalDigest(rows),rows,states};
}
async function verifyReports(db) {
  const reports=require('../../services/reportsService');
  const primary=await db.Batch.findOne({where:{batch_name:'MCA 2025'}});
  const session=await db.ResultSession.findOne({where:{batch_id:primary.batch_id,semester:'1',exam_session:'Dec',exam_year:2025}});
  const subject=await db.Subject.findOne({where:{session_id:session.session_id,subject_code:'MMC103'}});
  const sindhu=await db.Student.findOne({where:{usn:'1MV25MC074'}});
  const common={batch_id:String(primary.batch_id),semester:'1',session_id:String(session.session_id),pageSize:'100'};
  const original=await reports.getReport('class',{...common,mode:'original'}),effective=await reports.getReport('class',{...common,mode:'effective'});
  assert.equal(original.rows.find(r=>r.usn===sindhu.usn).result_status,'fail');assert.equal(effective.rows.find(r=>r.usn===sindhu.usn).result_status,'pass');
  for(const type of ['subject','consolidated','toppers','result-analysis','revaluation']){
    const report=await reports.getReport(type,{...common,...(type==='subject'?{subject_id:String(subject.subject_id)}:{})});assert.ok(report.rows.length,`${type} populated`);
  }
  const student=await reports.getReport('student',{batch_id:String(primary.batch_id),student_id:String(sindhu.student_id),semester:'all',session_id:'all'});
  assert.equal(student.semesters.length,3);
  const progress=await reports.getReport('student-progress',{batch_id:String(primary.batch_id),pageSize:'100',mode:'original'});
  assert.deepEqual(progress.semesters.map(s=>String(s.semester)),['1','2','3'],'Upcoming Semester 4 is excluded');
  assert.equal(progress.rows.find(r=>r.usn==='1MV25MC026').semesters['3'].first_attempt,'-');
  assert.equal(progress.rows.find(r=>r.usn==='1MV25MC025').semesters['1'].marks,null);
  assert.equal(progress.rows.find(r=>r.usn==='1MV25MC061').latest_cgpa,10);
  assert.equal(progress.rows.find(r=>r.usn==='1MV25MC001').latest_cgpa,8.16);
  const prafulProgress=progress.rows.find(r=>r.usn==='1MV25MC052');
  const regular=await db.Result.findOne({where:{student_id:prafulProgress.student_id,session_id:session.session_id,exam_type:'REGULAR'}});
  const originalMarks=await db.SubjectResult.sum('marks',{where:{result_id:regular.result_id}});
  assert.equal(prafulProgress.semesters['1'].marks,originalMarks,'Partial retake never replaces regular marks');
  assert.equal(prafulProgress.semesters['1'].first_attempt,'F');assert.equal(prafulProgress.semesters['1'].supplementary_pass,'P');
  const analytics=require('../../services/analyticsService');
  const overview=await analytics.getOverview({batch_id:String(primary.batch_id),mode:'effective',attempt:'all'});assert.ok(overview.parent.resultTotal>0);
  return 'All eight report types and Analytics overview verified against persisted demo data';
}
module.exports={inspect,logicalDigest,verify,verifyReports};
