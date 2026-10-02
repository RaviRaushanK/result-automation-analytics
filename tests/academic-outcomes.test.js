'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/models');
const outcomes = require('../services/academicOutcomeService');
const policy = require('../services/academicPolicy');
const migration = require('../migrations/20261003090000-stable-academic-courses');
after(() => db.sequelize.close());

function fixture() {
  const courses = Array.from({ length: 6 }, (_, i) => ({ course_id: i+1, batch_id: 1, semester: '1', subject_code: `MMC10${i+1}`, credits: i===5 ? 2 : 4, status: 'active', is_required: true, roster_verified: true }));
  const results = [], subjects = [];
  for (let student=1;student<=5;student++) {
    const regular = { result_id: student, student_id: student, session_id: 1, semester: '1', exam_year: 2025, exam_session: 'Dec', attempt_no: 7, exam_type: 'REGULAR' };
    results.push(regular);
    for (const course of courses) {
      if (student===4 && course.course_id===6) continue;
      const fail = student!==2 && course.course_id===3;
      subjects.push({ ...regular, subject_id: course.course_id, course_id: course.course_id, outcome_status: fail ? 'fail' : 'pass', outcome_marks: fail ? 40 : 80,
        grade: fail ? 'F' : 'A', grade_point: fail ? 0 : 8, grading_scheme_version: policy.SCHEME, credits_snapshot: course.credits });
    }
    if ([1,3,5].includes(student)) {
      const retake = { result_id: student+10, student_id: student, session_id: 2, semester: '1', exam_year: 2026, exam_session: 'Jun', attempt_no: 1, exam_type: 'BACKLOG' };
      results.push(retake);
      subjects.push({ ...retake, subject_id: student+100, course_id: student===5 ? 203 : 3, outcome_status: student===3 ? 'fail' : 'pass', outcome_marks: student===3 ? 30 : 90,
        grade: student===3 ? 'F' : 'O', grade_point: student===3 ? 0 : 10, grading_scheme_version: policy.SCHEME, credits_snapshot: 4 });
    }
  }
  return { courses, results, subjects };
}

test('course-level cross-session outcomes cover the five acceptance students without using attempt_no as semester chronology', () => {
  const data=fixture();
  for (const [student, first, sup, cleared] of [[1,'F','P',true],[2,'P','-',true],[3,'F','F',false],[4,'-','-',null],[5,'F','F',false]]) {
    const row=outcomes.semesterOutcome(data,student,'1');
    assert.equal(row.firstAttempt,first); assert.equal(row.supplementaryPass,sup); assert.equal(row.cleared,cleared);
  }
  const row=outcomes.semesterOutcome(data,1,'1');
  assert.equal(row.courses[2].attempts.length,2);
  assert.notEqual(row.courses[2].firstAttempt.subject_id,row.courses[2].latestAttempt.subject_id);
  assert.equal(row.withBacklog,'Y'); assert.equal(row.withoutBacklog,'N');
  assert.equal(outcomes.semesterOutcome(data,2,'1').withoutBacklog,'Y');
  assert.equal(outcomes.semesterOutcome(data,4,'1').withBacklog,'-');
  assert.equal(outcomes.semesterOutcome(data,1,'2').firstAttempt,'-');
});

test('unknown chronology, incomplete roster and ambiguous simultaneous attempts never produce clearance', () => {
  for (const mutation of [data=>{data.results[0].exam_session='Dec/Jan';},data=>{data.courses[0].roster_verified=false;},data=>{data.results.push({...data.results[0],result_id:999});},data=>{data.subjects[0].outcome_status=null;}]) {
    const data=fixture();mutation(data);
    const row=outcomes.semesterOutcome(data,1,'1');assert.equal(row.cleared,null);assert.equal(row.supplementaryPass,'-');
  }
  const data=fixture();data.subjects=data.subjects.filter(s=>!(s.student_id===1&&s.exam_type==='BACKLOG'));
  assert.equal(outcomes.semesterOutcome(data,1,'1').supplementaryPass,'-','No retake evidence is not a fabricated supplementary failure');
});

test('cumulative GPA is credit weighted, counts each stable course once, includes failed credits and rejects unknown grading provenance', () => {
  const data=fixture();
  assert.equal(outcomes.cumulative(data,1,'1'),8.36);
  assert.equal(outcomes.cumulative(data,2,'1'),8);
  assert.equal(outcomes.cumulative(data,3,'1'),6.55);
  assert.equal(outcomes.cumulative(data,1,'2'),null,'Missing previous-semester roster prevents accumulation');
  assert.equal(outcomes.cumulative(data,1,'1',policy.period(data.results[0])),6.55,'Later retakes do not rewrite earlier cumulative snapshots');
  const accepted=data.subjects.find(s=>s.student_id===1&&s.course_id===1);
  accepted.grading_scheme_version=null;assert.equal(outcomes.cumulative(data,1,'1'),null);
  accepted.grading_scheme_version=policy.SCHEME;accepted.grade_point=9;assert.equal(outcomes.cumulative(data,1,'1'),null,'Incompatible grade points are not reinterpreted');
});

test('migration maps exact normalized code within batch/semester and leaves conflicting definitions unmapped', () => {
  const row={ batch_id:1,semester:'1',subject_code:' MMC103 ',subject_name:'Database',subject_type:'theory',credits:4,max_internal:50,max_external:50,max_marks:100 };
  assert.equal(migration.mappingGroups([row,{...row,subject_code:'mmc103'}]).length,1);
  assert.equal(migration.mappingGroups([row,{...row,subject_code:'mmc103'}])[0].ambiguous,false);
  assert.equal(migration.mappingGroups([row,{...row,credits:3}])[0].ambiguous,true);
  assert.equal(migration.mappingGroups([row,{...row,subject_code:'MMC203'},{...row,batch_id:2},{...row,semester:'2'}]).length,4);
});

test('new regular imports require full verified roster; all three retake types accept only actual attempted subjects', async () => {
  const controller=require('../controllers/resultController');
  const oldSubjects=db.Subject.findAll,oldCourses=db.AcademicCourse.findAll;
  const subjects=Array.from({length:6},(_,i)=>({subject_id:i+1,course_id:i+1,subject_code:`MMC10${i+1}`,subject_name:`Course ${i+1}`,credits:4,max_internal:50,max_external:50,max_marks:100}));
  db.Subject.findAll=async()=>subjects;db.AcademicCourse.findAll=async()=>subjects.map(s=>({...s,is_required:true,roster_verified:true}));
  const options={session:{batch_id:1,semester:'1'}};
  try{
    const inputs={internal_3:'35',external_3:'40'};
    assert.equal((await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},inputs,{...options,exam_type:'REGULAR'})).hasErrors,true);
    for(const exam_type of policy.RETAKE_TYPES){
      const value=await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},inputs,{...options,exam_type});
      assert.equal(value.hasErrors,false);assert.equal(value.payload.subjects.length,1);
      assert.equal(value.payload.subjects[0].subject_id,3);assert.equal(value.payload.subjects[0].totalMarks,75);
      assert.equal(value.payload.failedSubjectCount,0);assert.equal(value.payload.sgpa,null);assert.equal(value.payload.cgpa,null);
      assert.equal(value.payload.subjects[0].grading_scheme_version,policy.SCHEME);
    }
    assert.equal((await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},{...inputs,external_3:''},{...options,exam_type:'BACKLOG'})).hasErrors,true);
    assert.equal((await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},{},{...options,exam_type:'REPEAT'})).hasErrors,true);
    assert.equal((await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},{internal_999:30,external_999:40},{...options,exam_type:'REPEAT'})).hasErrors,true);
    const full=Object.fromEntries(subjects.flatMap(s=>[[`internal_${s.subject_id}`,40],[`external_${s.subject_id}`,40]]));
    const regular=await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},full,options);
    assert.equal(regular.hasErrors,false);assert.equal(regular.payload.sgpa,9);assert.equal(regular.payload.cgpa,null);
    subjects[2].course_id=null;
    assert.equal((await controller._test.buildValidatedPayload(1,{usn:'TEST',name:'Test'},inputs,{...options,exam_type:'BACKLOG'})).hasErrors,true);
  }finally{db.Subject.findAll=oldSubjects;db.AcademicCourse.findAll=oldCourses;}
});

test('session controller allows different periods of one semester and rejects identical periods', async () => {
  const controller=require('../controllers/sessionController');
  const originals=[db.Batch.findByPk,db.ResultSession.findOne,db.ResultSession.create];
  db.Batch.findByPk=async()=>({batch_id:1});
  db.ResultSession.findOne=async({where})=>where.exam_session==='Dec'&&where.exam_year===2025?{session_id:1}:null;
  db.ResultSession.create=async data=>data;
  const invoke=async body=>{let status,data;await controller.create({body},{status:n=>{status=n;return{json:value=>{data=value;}};}});return{status,data};};
  try{
    assert.equal((await invoke({batch_id:1,semester:'1',exam_session:'Jun',exam_year:2026})).status,201);
    assert.equal((await invoke({batch_id:1,semester:'1',exam_session:'Dec',exam_year:2025})).status,409);
  }finally{[db.Batch.findByPk,db.ResultSession.findOne,db.ResultSession.create]=originals;}
});

test('cumulative GPA spans semesters by credit points, not an average of semester GPAs or the latest attempt', () => {
  const data=fixture();
  const course={...data.courses[0],course_id:20,semester:'2',subject_code:'MMC201',credits:2};
  const result={...data.results[0],result_id:30,semester:'2',session_id:3,exam_session:'Dec',exam_year:2026};
  data.courses.push(course);data.results.push(result);
  data.subjects.push({...result,course_id:20,outcome_status:'pass',grade:'C',grade_point:5,credits_snapshot:2,grading_scheme_version:policy.SCHEME});
  assert.equal(outcomes.cumulative(data,1,'2'),8.08);
  assert.notEqual(outcomes.cumulative(data,1,'2'),Number(((8.36+5)/2).toFixed(2)));
  const passing=data.subjects.find(s=>s.student_id===1&&s.course_id===1);
  data.subjects.push({...passing,...result,result_id:40,semester:'1',exam_type:'REPEAT',outcome_marks:100,grade:'O',grade_point:10});
  assert.equal(outcomes.cumulative(data,1,'2'),8.08,'A higher later mark does not silently replace an already accepted pass');
  data.courses[0].roster_verified=false;
  assert.equal(outcomes.cumulative(data,1,'2'),null);
});

test('first-sitting evidence and semester clearance are distinct; all authoritative course passes can prove clearance', () => {
  const data=fixture();
  const first=data.results.find(r=>r.student_id===2);
  data.results=data.results.filter(r=>r!==first);
  data.subjects=data.subjects.map(s=>s.student_id===2?{...s,exam_type:'REPEAT'}:s);
  data.results.push({...first,exam_type:'REPEAT'});
  const row=outcomes.semesterOutcome(data,2,'1');
  assert.equal(row.cleared,true);assert.equal(row.firstAttempt,'-');assert.equal(row.supplementaryPass,'-');
  assert.equal(outcomes.cumulative(data,2,'1'),null);
  assert.equal(policy.period({exam_session:'Jan',exam_year:null}),null);
  assert.equal(policy.period({exam_session:'Jan',exam_year:2026}),2026*12);
});

test('retake history is checked by course and earlier examination period with a non-blocking review path', async () => {
  const repository=require('../repositories/academicRepository');
  const saved=repository.priorCourses;
  repository.priorCourses=async()=>[{course_id:3,exam_session:'Dec',exam_year:2025}];
  try{
    const session={batch_id:1,exam_session:'Jun',exam_year:2026};
    assert.deepEqual(await outcomes.retakeWarnings(session,'TEST',[{course_id:3,subject_code:'MMC103'}]),[]);
    assert.match((await outcomes.retakeWarnings(session,'TEST',[{course_id:203,subject_code:'MMC203'}]))[0],/MMC203/);
    assert.equal((await outcomes.retakeWarnings({...session,exam_year:2024},'TEST',[{course_id:3,subject_code:'MMC103'}])).length,1);
    repository.priorCourses=async()=>[{course_id:3,exam_session:'Jun',exam_year:2026,session_id:2,attempt_no:1}];
    assert.deepEqual(await outcomes.retakeWarnings({...session,session_id:2},'TEST',[{course_id:3,subject_code:'MMC103'}],undefined,2),[]);
    assert.equal((await outcomes.retakeWarnings({...session,session_id:3},'TEST',[{course_id:3,subject_code:'MMC103'}],undefined,2)).length,1);
  }finally{repository.priorCourses=saved;}
});

test('subject creation passes the academic semester into stable-course resolution and never accepts an invalid session', async () => {
  const controller=require('../controllers/subjectController');
  const service=require('../services/academicCourseService');
  const saved=[db.ResultSession.findByPk,db.Subject.findOne,db.Subject.create,db.sequelize.transaction,service.resolve];
  let attributes,identity,created;
  db.ResultSession.findByPk=async(id,options)=>{attributes=options.attributes;return{session_id:2,batch_id:1,semester:'1'};};
  db.Subject.findOne=async()=>null;
  db.sequelize.transaction=async fn=>fn({});
  service.resolve=async(session)=>{identity=session;return{course_id:3};};
  db.Subject.create=async row=>{created=row;return row;};
  let status;
  try{
    await controller.create({body:{session_id:2,batch_id:1,subject_code:'MMC103',subject_name:'Course',subject_type:'theory',credits:4,max_internal:50,max_external:50,max_marks:100}},
      {status:n=>{status=n;return{json(){}};}});
    assert.equal(status,201);assert.ok(attributes.includes('semester'));assert.equal(identity.semester,'1');assert.equal(created.course_id,3);
  }finally{[db.ResultSession.findByPk,db.Subject.findOne,db.Subject.create,db.sequelize.transaction,service.resolve]=saved;}
  await assert.rejects(()=>service.resolve({batch_id:1},{}),/valid academic semester/);
});

test('academic roster endpoints require administrators and validate scope and explicit confirmation before writes', async () => {
  const express=require('express');const app=express();app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.user={role:req.get('x-role')};req.session={adminId:1};next();});
  app.use('/subjects',require('../routes/subjectRoutes'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/subjects/courses`;
  try{
    for(const role of ['student','faculty'])for(const method of ['GET','POST'])assert.equal((await fetch(base,{method,headers:{'x-role':role}})).status,403);
    for(const body of ['batch_id=1&semester=25&confirm=1&required_courses=1','batch_id=1&semester=1&required_courses=1','batch_id=1&semester=1&confirm=1&required_courses=oops']){
      assert.equal((await fetch(base,{method:'POST',headers:{'x-role':'admin','Content-Type':'application/x-www-form-urlencoded'},body})).status,400);
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('additive course migration is idempotent and does not update academic results or revaluation ledger', async () => {
  const S=require('sequelize');const tables=[];const columns={subjects:{},results:{},subject_results:{}};const indexes=[];const statements=[];let creations=0,additions=0;
  const row={subject_id:1,session_id:1,batch_id:1,semester:'1',subject_code:'MMC103',subject_name:'Database',subject_type:'theory',credits:4,max_internal:50,max_external:50,max_marks:100};
  const q={showAllTables:async()=>tables,createTable:async name=>{tables.push(name);creations++;},showIndex:async()=>indexes,
    addIndex:async(table,fields,options)=>indexes.push(options),describeTable:async table=>columns[table],
    addColumn:async(table,name,options)=>{columns[table][name]=options;additions++;},
    sequelize:{transaction:async fn=>fn({}),query:async sql=>{statements.push(sql);if(sql.startsWith('SELECT s.*'))return[row];if(sql.startsWith('SELECT DISTINCT'))return[{batch_id:1,semester:'1',session_id:1}];if(sql.startsWith('SELECT * FROM academic_courses'))return[{...row,course_id:1}];return[];}}};
  await migration.up(q,S);const count=additions;await migration.up(q,S);
  assert.equal(creations,1);assert.equal(additions,count);assert.equal(indexes.length,1);
  assert.equal(columns.results.cgpa_is_cumulative.defaultValue,false);
  assert.equal(columns.results.cgpa_source.defaultValue,'LEGACY');
  assert.equal(columns.subject_results.grade_point.allowNull,true);
  assert.ok(statements.every(sql=>!/^UPDATE (results|subject_results|revaluation_results)\b/i.test(sql)));
});

test('session-scoped attempt numbers order a shared sitting without becoming lifetime-semester attempts', () => {
  const data=fixture();const first=data.results.find(r=>r.student_id===2);
  const later={...first,result_id:99,attempt_no:8};data.results.push(later);
  data.subjects.push(...data.subjects.filter(s=>s.student_id===2).map(s=>({...s,...later})));
  assert.equal(outcomes.semesterOutcome(data,2,'1').firstAttempt,'P');
  assert.equal(outcomes.semesterOutcome(data,2,'1').firstRegularResult.attempt_no,7);
  later.session_id=999;
  assert.equal(outcomes.semesterOutcome(data,2,'1').firstAttempt,'-','Two distinct regular sessions in one undated month are ambiguous');
});

test('session academic semester cannot change after configuring stable course offerings', async () => {
  const controller=require('../controllers/sessionController');
  const saved=[db.ResultSession.findByPk,db.ResultSession.findOne,db.Subject.count,db.ResultSession.update];let wrote=false,status;
  db.ResultSession.findByPk=async()=>({session_id:1,batch_id:1,semester:'1'});
  db.ResultSession.findOne=async()=>null;db.Subject.count=async()=>1;
  db.ResultSession.update=async()=>{wrote=true;};
  try{
    await controller.update({params:{id:1},body:{semester:'2',exam_session:'Jun',exam_year:2026}},{status:n=>{status=n;return{json(){}};}});
    assert.equal(status,409);assert.equal(wrote,false);
  }finally{[db.ResultSession.findByPk,db.ResultSession.findOne,db.Subject.count,db.ResultSession.update]=saved;}
});

test('explicit semester roster confirmation writes only reviewed course definitions and rejects unmapped offerings', async () => {
  const controller=require('../controllers/academicCoursesController');
  const saved=[db.AcademicCourse.findAll,db.Subject.count,db.sequelize.transaction];const writes=[];let unmapped=0;
  db.AcademicCourse.findAll=async()=>[1,2].map(course_id=>({course_id,update:async data=>writes.push({course_id,...data})}));
  db.Subject.count=async()=>unmapped;db.sequelize.transaction=async fn=>fn({LOCK:{UPDATE:'UPDATE'}});
  let status,redirected;
  const response={status:n=>{status=n;return{send(){}};},redirect:url=>{redirected=url;}};
  const request={body:{batch_id:'1',semester:'1',confirm:'1',required_courses:['1']},session:{adminId:7}};
  try{
    await controller.confirm(request,response,error=>{throw error;});
    assert.match(redirected,/saved=1/);assert.equal(writes.length,2);
    assert.equal(writes[0].is_required,true);assert.equal(writes[1].is_required,false);
    assert.ok(writes.every(row=>row.roster_verified&&row.reviewed_by===7&&row.reviewed_at instanceof Date));
    writes.length=0;unmapped=1;
    await controller.confirm(request,response,error=>{throw error;});
    assert.equal(status,409);assert.equal(writes.length,0);
  }finally{[db.AcademicCourse.findAll,db.Subject.count,db.sequelize.transaction]=saved;}
});

test('Progress cumulative GPA includes later semesters even when the newest Result is an earlier-semester retake', async () => {
  const repository=require('../repositories/reportsRepository');const service=require('../services/reportsService');
  const saved=[repository.batch,repository.progressSemesters,repository.progressStudentCount,repository.progressStudents,outcomes.load];
  const data=fixture();const course={...data.courses[0],course_id:20,semester:'2',subject_code:'MMC201',credits:2};
  const result={...data.results[0],result_id:30,semester:'2',session_id:3,exam_session:'Dec',exam_year:2026};
  data.courses.push(course);data.results.push(result);
  data.subjects.push({...result,course_id:20,outcome_status:'pass',result_status:'pass',marks:55,grade:'C',grade_point:5,credits_snapshot:2,grading_scheme_version:policy.SCHEME});
  for(const subject of data.subjects){subject.result_status=subject.outcome_status;subject.marks=subject.outcome_marks??subject.marks;}
  const retake=data.results.find(r=>r.student_id===1&&r.exam_type==='BACKLOG');retake.exam_session='Jan';retake.exam_year=2027;
  Object.assign(data.subjects.find(s=>s.student_id===1&&s.exam_type==='BACKLOG'),{exam_session:'Jan',exam_year:2027});
  repository.batch=async()=>({batch_id:1,batch_name:'Test',start_year:2025});
  repository.progressSemesters=async()=>[{semester:'1'},{semester:'2'}];repository.progressStudentCount=async()=>({total_rows:1});
  repository.progressStudents=async()=>[{student_id:1,usn:'TEST',student_name:'Test'}];outcomes.load=async()=>data;
  try{
    const report=await service.getReport('student-progress',{batch_id:'1',mode:'effective'});
    assert.equal(report.rows[0].latest_cgpa,8.08);
    assert.equal(report.rows[0].latest_cgpa_source.through_semester,2);
    assert.equal(report.rows[0].semesters['1'].cgpa,null,'No stored cumulative provenance is fabricated');
    data.subjects[0].grading_scheme_version=null;
    assert.equal((await service.getReport('student-progress',{batch_id:'1'})).rows[0].latest_cgpa,null);
  }finally{[repository.batch,repository.progressSemesters,repository.progressStudentCount,repository.progressStudents,outcomes.load]=saved;}
});

test('read-only MySQL course history deduplicates effective events and preserves original values', {skip:process.env.REPORTS_DB_TEST!=='1'}, async () => {
  await db.sequelize.authenticate();
  const query=db.sequelize.query.bind(db.sequelize);let count=0;
  const cte=`WITH academic_courses AS (
    SELECT 1 course_id,1 batch_id,'1' semester,'MMC101' subject_code,4 credits,'active' status,1 is_required,1 roster_verified
    UNION ALL SELECT 2,1,'1','MMC102',4,'active',1,1),
    students AS (SELECT 1 student_id,1 batch_id,'TEST' usn,NULL deleted_at),
    result_sessions AS (SELECT 1 session_id,1 batch_id,'1' semester,'Dec' exam_session,2025 exam_year UNION ALL SELECT 2,1,'1','Jun',2026),
    results AS (SELECT 1 result_id,1 student_id,1 session_id,7 attempt_no,'REGULAR' exam_type UNION ALL SELECT 2,1,2,1,'BACKLOG'),
    subjects AS (SELECT 1 subject_id,1 session_id,1 course_id,'MMC101' subject_code,4 credits,100 max_marks
      UNION ALL SELECT 2,1,2,'MMC102',4,100 UNION ALL SELECT 3,2,1,'MMC101',4,100),
    subject_results AS (SELECT 1 subject_result_id,1 result_id,1 subject_id,40 marks,'fail' result_status,'F' grade,NULL course_id_snapshot
      UNION ALL SELECT 2,1,2,80,'pass','A',NULL UNION ALL SELECT 3,2,3,70,'pass','B+',1),
    revaluation_results AS (SELECT 1 revaluation_id,1 subject_result_id,1 revaluation_no,1 is_effective,'pending' revaluation_status,90 revised_marks,'pass' revised_status,'O' revised_grade
      UNION ALL SELECT 2,1,2,1,'rejected',90,'pass','O'
      UNION ALL SELECT 3,2,1,1,'approved',80,'pass','A'
      UNION ALL SELECT 4,2,2,1,'approved',30,'fail','F') `;
  db.sequelize.query=(sql,options)=>{count++;assert.match(sql.trim(),/^SELECT\b/);return query(cte+sql,options);};
  try{
    const original=await outcomes.load(1,[1],'original');assert.equal(count,3);
    const effective=await outcomes.load(1,[1],'effective');assert.equal(count,6);
    assert.equal(original.subjects.length,3);assert.equal(effective.subjects.length,3);
    assert.equal(outcomes.semesterOutcome(original,1,'1').supplementaryPass,'P');
    assert.equal(outcomes.semesterOutcome(effective,1,'1').supplementaryPass,'F');
    assert.equal(effective.subjects.find(s=>s.subject_result_id===1).outcome_status,'fail','Pending/rejected do not clear the original failure');
    assert.equal(effective.subjects.find(s=>s.subject_result_id===2).outcome_status,'fail','Highest approved effective event wins');
    assert.equal(effective.subjects.find(s=>s.subject_result_id===2).marks,80,'Overlay does not replace original marks');
    assert.equal(effective.subjects.find(s=>s.subject_id===3).course_id_snapshot,1);
  }finally{db.sequelize.query=query;}
});
