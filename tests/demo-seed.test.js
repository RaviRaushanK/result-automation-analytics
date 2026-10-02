'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const data=require('../seed/academic/data');
const {guard,options}=require('../seed/academic/safety');
const policy=require('../services/academicPolicy');
const quick=require('../seed/seed_quick_demo');

test('Single npm demo command defaults only absent environment and confirms only the named local database',()=>{
  const env={DB_NAME:'academic_result_analytics_db',DB_HOST:'localhost'};
  assert.deepEqual(quick.configuration(env).args,['--reset','--confirm-db',env.DB_NAME]);
  assert.equal(quick.configuration(env).environment.NODE_ENV,'development');
  assert.equal(env.NODE_ENV,undefined);
  assert.deepEqual(quick.configuration(env,true).args,['--verify','--confirm-db',env.DB_NAME]);
  for(const mutation of [{NODE_ENV:'production'},{NODE_ENV:''},{APP_ENV:'production'},{DB_NAME:'other_db'},{DB_HOST:'remote.example.com'}])assert.throws(()=>quick.configuration({...env,...mutation}));
});

test('Demo plan is deterministic and keeps exact required identities',()=>{
  assert.deepEqual(data.plan(),data.plan());
  assert.equal(data.uuid('p1'),data.uuid('p1'));
  const plan=data.plan();assert.equal(plan.students.length,36);
  assert.deepEqual(data.REAL_STUDENTS,[
    {usn:'1MV25MC061',name:'RAVI RAUSHAN KUMAR',email:'raviraushan253@gmail.com'},
    {usn:'1MV25MC052',name:'PRAFUL KRISHNAPPA VAJJARAMATTI',email:'example1@gmail.com'},
    {usn:'1MV25MC074',name:'SINDHUKUMAR S',email:'example2@gmail.com'}
  ]);
  for(const student of plan.students){
    const real=data.REAL_STUDENTS.find(r=>r.usn===student.usn);
    if(real){assert.equal(student.name,real.name);assert.equal(student.email,real.email);}
    else {assert.match(student.name,/^DEMO /);assert.match(student.email,/@example\.com$/);}
  }
  assert.equal(new Set(plan.students.map(s=>s.usn)).size,36);
});

test('Guard requires explicit environment, local database, operation and exact confirmation',()=>{
  const env={NODE_ENV:'development',DB_NAME:'academic_result_analytics_db',DB_HOST:'localhost'};
  const config=options(['--reset','--confirm-db',env.DB_NAME]);
  assert.doesNotThrow(()=>guard(env,config));
  assert.doesNotThrow(()=>guard({...env,NODE_ENV:'test'},{...config,reset:false,verify:true}));
  for(const mutation of [{NODE_ENV:'production'},{NODE_ENV:'PRODUCTION'},{NODE_ENV:''},
    {APP_ENV:'production'},{DB_NAME:'live_results'},{DB_HOST:'remote.example.com'}])assert.throws(()=>guard({...env,...mutation},config));
  assert.throws(()=>guard(env,{...config,database:'wrong'}));
  assert.throws(()=>guard(env,{database:env.DB_NAME}));
  assert.throws(()=>guard(env,{...config,verify:true}));
  assert.throws(()=>options(['--confirm-db']));assert.throws(()=>options(['--force']));
});

test('CLI and legacy entry point refuse production before connecting',()=>{
  for(const file of ['seed_demo.js','seed_all.js']){
    const result=spawnSync(process.execPath,[path.resolve(__dirname,'../seed',file),'--reset','--confirm-db','fake'],{
      env:{...process.env,NODE_ENV:'production',DB_HOST:'unreachable.invalid'},encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/production.*refused/i);
    assert.doesNotMatch(result.stderr,/ECONN|ENOTFOUND/);
  }
});

test('Full REGULAR and partial retakes preserve session-scoped attempt identities',()=>{
  const plan=data.plan();assert.equal(plan.results.length,102);
  assert.deepEqual(Object.fromEntries(policy.EXAM_TYPES.map(t=>[t,plan.results.filter(r=>r.exam_type===t).length])),
    {REGULAR:92,BACKLOG:6,SUPPLEMENTARY:2,REPEAT:2});
  const keys=new Set();
  for(const result of plan.results){
    const key=`${result.usn}:${result.session}:${result.attempt_no}`;assert.ok(!keys.has(key));keys.add(key);
    const count=Object.keys(result.values).length;
    if(result.exam_type==='REGULAR')assert.equal(count,6);
    else assert.ok(count===1||count===2);
  }
  const attempts=plan.results.filter(r=>r.usn==='1MV25MC017'&&r.session==='p1');
  assert.deepEqual(attempts.map(r=>r.attempt_no),[1,2]);
  const praful=plan.results.filter(r=>r.usn==='1MV25MC052');
  const regular=praful.find(r=>r.session==='p1'),retake=praful.find(r=>r.session==='p1jun');
  assert.equal(regular.values[2],42);assert.equal(retake.values[2],75);
  const first=plan.sessions.find(s=>s.key===regular.session),later=plan.sessions.find(s=>s.key===retake.session);
  assert.equal(first.semester,later.semester);assert.notEqual(first.key,later.key);
  assert.equal(data.courses(1)[2].subject_code,'MMC103');
  assert.ok(data.courses(2).every(c=>/^MMCL?2/.test(c.subject_code)));
});

test('Marks, maxima, grade boundaries and topper tie use the production policy',()=>{
  const plan=data.plan();
  for(const spec of plan.results){
    const session=plan.sessions.find(s=>s.key===spec.session),courses=data.courses(Number(session.semester));
    for(const [index,pct]of Object.entries(spec.values)){
      const course=courses[index],m=data.marks(course,pct);
      assert.ok(m.marks>0&&m.marks<=course.max_marks);
      assert.equal(m.marks,m.internal_marks+m.external_marks);
      assert.ok(m.internal_marks<=course.max_internal&&m.external_marks<=course.max_external);
      assert.equal(m.grade,policy.gradeFromPercent(Math.floor(m.marks*100/course.max_marks)).grade);
    }
  }
  for(const semester of [1,2,3])assert.deepEqual(data.percentages('1MV25MC061',semester),data.percentages('1MV25MC011',semester));
  assert.deepEqual(data.percentages('1MV25MC010',1).map(p=>data.marks(data.courses(1)[0],p).grade),['F','C','C','B','B','B+']);
  assert.equal(data.courses(3).find(c=>c.subject_code==='MMC305').max_marks,150);
  assert.ok(data.percentages('1MV26MC002',1).every(p=>p>=50));
});

test('Ledger scenarios isolate approved-effective, pending and rejected events',()=>{
  const plan=data.plan(),events=plan.revaluations;
  assert.equal(events.length,9);
  assert.equal(events.filter(e=>e.is_effective).length,5);
  for(const event of events)if(event.revaluation_status!=='approved')assert.equal(event.is_effective,false);
  const multiple=events.filter(e=>e.usn==='1MV25MC008');
  assert.equal(multiple.length,3);assert.deepEqual(multiple.filter(e=>e.is_effective).map(e=>e.revaluation_no),[2]);
  assert.ok(data.eventDate('p1',1)>data.eventDate('p1'));
  assert.ok(plan.sessions.some(s=>s.upcoming&&s.semester==='4'));
  assert.ok(!plan.results.some(r=>r.session==='p4'));
  assert.equal(plan.batches.find(b=>b.key==='unknown').verified,false);
});

test('Persisted demo academic scenarios and all report/Analytics smoke checks',{skip:process.env.DEMO_SEED_DB_TEST!=='1'},async()=>{
  const db=require('../database/models');
  try{
    const verification=require('../seed/academic/verify');
    const result=await verification.verify(db);
    assert.equal(result.counts.students,36);assert.equal(result.counts.subjectResults,563);
    assert.match(await verification.verifyReports(db),/All eight report types/);
  }finally{await db.sequelize.close();}
});
