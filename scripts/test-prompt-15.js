/**
 * scripts/test-prompt-15.js - PROMPT 15 acceptance harness.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const crypto = require('crypto');
const db = require('../database/models');
const { Batch, ResultSession, Student, Result, Subject, SubjectResult, ImportLog, OcrExtraction, RevaluationResult, AdminUser } = db;
const ctrl = require('../controllers/revaluationController');

let pass = 0, fail = 0;
const check = (n, c) => { if(c){pass++;console.log('  PASS:',n);}else{fail++;console.log('  FAIL:',n);} };

function mkRes(){
  const r={_status:200,_redirectTo:null,_rendered:null,_json:null,
    status(c){r._status=c;return r;},redirect(u){r._redirectTo=u;return r;},
    render(v,vars){r._rendered={view:v,vars};return r;},json(o){r._json=o;return r;}};
  return r;
}
function mkReq(o={}){return{params:o.params||{},body:o.body||{},query:o.query||{},session:o.session||{},file:o.file||null,app:{get:()=>undefined},protocol:'http',get:()=>'localhost',headers:{}};}

async function buildFixtures() {
  const c = { batch:null,session:null,student:null,subjects:[],srs:[],extraSr:null,result:null,importLog:null,ocr:null,adminRow:null,revalIds:[] };
  const batch = await Batch.create({ batch_uuid:crypto.randomUUID(),department_id:1,batch_name:'__RAAS_P15__',start_year:2026,end_year:2027,status:'active' });
  c.batch = batch;
  const session = await ResultSession.create({ session_uuid:crypto.randomUUID(),batch_id:batch.batch_id,semester:'Sem P15',exam_session:'NOV',exam_year:2026 });
  c.session = session;
  const student = await Student.create({ student_uuid:crypto.randomUUID(),batch_id:batch.batch_id,usn:'P15T'+Date.now(),student_name:'Prompt 15 Tester',email:'p15.'+Date.now()+'@raas.local',status:'active' });
  c.student = student;
  const stamp = Date.now().toString().slice(-6);
  const defs = [
    { code:'P15A_'+stamp,name:'Maths',  credits:4,max_i:50,max_e:100,max_m:150 },
    { code:'P15B_'+stamp,name:'Physics',credits:3,max_i:40,max_e: 60,max_m:100 },
    { code:'P15C_'+stamp,name:'Chem',   credits:3,max_i:40,max_e: 60,max_m:100 }
  ];
  for(const d of defs){
    const s = await Subject.create({ session_id:session.session_id,subject_uuid:crypto.randomUUID(),subject_code:d.code,subject_name:d.name,subject_type:'theory',credits:d.credits,max_internal:d.max_i,max_external:d.max_e,max_marks:d.max_m });
    c.subjects.push(s);
  }
  const result = await Result.create({ result_uuid:crypto.randomUUID(),student_id:student.student_id,session_id:session.session_id,attempt_no:1,exam_type:'REGULAR',sgpa:7.0,cgpa:7.0,result_status:'pass',failed_subject_count:0 });
  c.result = result;
  const marksDefs = [{idx:0,m:90,g:'A',s:'pass'},{idx:1,m:25,g:'F',s:'fail'},{idx:2,m:55,g:'B',s:'pass'}];
  for(const m of marksDefs){
    const sr = await SubjectResult.create({ result_id:result.result_id,subject_id:c.subjects[m.idx].subject_id,marks:m.m,grade:m.g,result_status:m.s });
    if(m.idx===2) c.extraSr=sr; else c.srs.push(sr);
  }
  const admin = await AdminUser.create({ admin_uuid:crypto.randomUUID(),username:'__raas_p15_admin__'+Date.now(),email:'__raas_p15_admin__'+Date.now()+'@raas.local',password_hash:'x',role:'admin',status:'active' });
  c.adminRow = admin;
  const importLog = await ImportLog.create({ session_id:session.session_id,uploaded_by:admin.admin_id,file_name:'__raas_p15__.pdf',file_path:'/uploads/__raas_p15__.pdf',file_type:'pdf',import_type:'REVALUATION',total_records:c.srs.length,imported_records:0,skipped_records:0,status:'extracted' });
  c.importLog = importLog;
  const sj = [
    { subject_result_id:c.srs[0].subject_result_id,subject_id:c.subjects[0].subject_id,subject_code:c.subjects[0].subject_code,subject_name:c.subjects[0].subject_name,original_marks:c.srs[0].marks,original_status:c.srs[0].result_status,ocr_subject_code:c.subjects[0].subject_code,normalized_code:c.subjects[0].subject_code.replace(/[^A-Z0-9]/gi,''),match_state:'MATCHED',revised_internal_marks:30,revised_external_marks:50,revised_marks:80,revised_status_candidate:'pass',raw_status:null,confidence:0.95,raw_line:'OCR0' },
    { subject_result_id:c.srs[1].subject_result_id,subject_id:c.subjects[1].subject_id,subject_code:c.subjects[1].subject_code,subject_name:c.subjects[1].subject_name,original_marks:c.srs[1].marks,original_status:c.srs[1].result_status,ocr_subject_code:c.subjects[1].subject_code,normalized_code:c.subjects[1].subject_code.replace(/[^A-Z0-9]/gi,''),match_state:'MATCHED',revised_internal_marks:15,revised_external_marks:8,revised_marks:23,revised_status_candidate:'fail',raw_status:null,confidence:0.95,raw_line:'OCR1' }
  ];
  const umd = [{ ocr_subject_code:'P15C_'+stamp,raw_line:'P15C: 20+30',match_state:'UNMATCHED',normalized_code:('P15C_'+stamp).replace(/[^A-Z0-9]/gi,'') }];
  const ext = {
    result_id:result.result_id,attempt_no:1,exam_type:'REGULAR',
    ocr:{ extraction_status:'extracted',extraction_method:'test',warnings:[],unmatched_ocr_codes:[],unmatched_ocr_details:umd,student_candidates:{name:student.student_name,usn:student.usn},semester_candidate:5,subjects:sj },
    subjects:sj,student_id:student.student_id,session_id:session.session_id,
    attempt:{attempt_no:1,exam_type:'REGULAR'},
    documents:[{file_name:importLog.file_name,file_url:'/uploads/x.pdf'}]
  };
  const ocr = await OcrExtraction.create({ import_id:importLog.import_id,raw_text:'P15A: 30+50\nP15B: 15+8\nP15C: 20+30',extracted_json:ext,confidence_score:95.00,validation_status:'pending' });
  c.ocr = ocr;
  return c;
}

async function baseBody(c, unmatched) {
  const b = {};
  b['decision_'+c.srs[0].subject_result_id]='accept';
  b['internal_'+c.srs[0].subject_result_id]='30';
  b['external_'+c.srs[0].subject_result_id]='50';
  b['decision_'+c.srs[1].subject_result_id]='accept';
  b['internal_'+c.srs[1].subject_result_id]='19';
  b['external_'+c.srs[1].subject_result_id]='10';
  if(unmatched) Object.assign(b,unmatched);
  return b;
}


async function step1(c) {
  console.log('\n[1] showReview exposes unmatched_ocr_details');
  const r = mkRes();
  await ctrl.showReview(mkReq({ params: { importId: c.importLog.import_id } }), r);
  check('showReview rendered', !!r._rendered);
  if (!r._rendered) throw new Error('aborting step1');
  const v = r._rendered.vars || {};
  check('meta.unmatched non-empty', Array.isArray(v.meta && v.meta.unmatched) && v.meta.unmatched.length > 0);
  check('unmatched has ocr_subject_code', !!(v.meta && v.meta.unmatched[0] && v.meta.unmatched[0].ocr_subject_code));
  check('unmatched has raw_line', !!(v.meta && v.meta.unmatched[0] && v.meta.unmatched[0].raw_line));
}

async function step2(c) {
  console.log('\n[2] submitReview saves valid unmatched attachment');
  // extraSr is the 3rd SubjectResult not in selected subjects — safe target.
  const body = await baseBody(c, { 'unmatched_attach_0': String(c.extraSr.subject_result_id), 'attach_internal_0': '40', 'attach_external_0': '40' });
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params:{ importId: c.importLog.import_id }, body, session:{ adminId: c.adminRow.admin_id } }), r);
  check('redirected on success', !!r._redirectTo && /\/revaluation\/review\//.test(r._redirectTo));
  const frozen = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const review = (frozen.extracted_json || {}).review || null;
  check('proposal saved', review && Array.isArray(review.proposal));
  if (!review || !Array.isArray(review.proposal)) return;
  check('proposal has 3 entries', review.proposal.length === 3);
  const um = review.proposal.find(p => p.source === 'UNMATCHED_OCR');
  check('unmatched entry in proposal', !!um);
  if (!um) return;
  check('bound_to_srid set', um.bound_to_srid != null);
  check('decision=accept', um.decision === 'accept');
  check('source=UNMATCHED_OCR', um.source === 'UNMATCHED_OCR');
  check('total_marks=80', um.proposed_revised_total_marks === 80);
  check('ocr_subject_code preserved', !!um.ocr_subject_code);
}

async function step3(c) {
  console.log('\n[3] submitReview rejects forged target');
  const body = await baseBody(c, { 'unmatched_attach_0': '999999', 'attach_internal_0': '40', 'attach_external_0': '40' });
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params:{ importId: c.importLog.import_id }, body, session:{ adminId: c.adminRow.admin_id } }), r);
  check('redirected on forged target', !!r._redirectTo && /\/revaluation\/(review|extraction)\//.test(r._redirectTo));
  check('redirect contains error', !!(r._redirectTo && r._redirectTo.includes('error=')));
  const frozen = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const review = (frozen.extracted_json || {}).review || null;
  check('prior proposal preserved', review && review.proposal && review.proposal.length === 3);
}

async function step4(c) {
  console.log('\n[4] unmatched duplicate of regular row flagged');
  const body = await baseBody(c, { 'unmatched_attach_0': String(c.srs[0].subject_result_id), 'attach_internal_0': '40', 'attach_external_0': '40' });
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params:{ importId: c.importLog.import_id }, body, session:{ adminId: c.adminRow.admin_id } }), r);
  check('re-rendered on duplicate', !!r._rendered && r._rendered.view === 'revaluation/review');
  const v = r._rendered && r._rendered.vars;
  check('errors non-empty', v && v.errors && Object.keys(v.errors).length > 0);
}


async function step5(c) {
  console.log('\n[5] out-of-range marks on unmatched rejected');
  // Use extraSr (3rd SubjectResult) to avoid duplicate-target conflicts with step2's saved accept.
  const body = await baseBody(c, { 'unmatched_attach_0': String(c.extraSr.subject_result_id), 'attach_internal_0': '999', 'attach_external_0': '10' });
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params:{ importId: c.importLog.import_id }, body, session:{ adminId: c.adminRow.admin_id } }), r);
  check('re-rendered or redirected on bad marks', !!(r._rendered || (r._redirectTo && r._redirectTo.includes('error='))));
  const frozen = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const review = (frozen.extracted_json || {}).review || null;
  check('prior proposal preserved', review && review.proposal && review.proposal.length === 3);
}

async function step6(c) {
  console.log('\n[6] approveReview creates events');
  const r = mkRes();
  await ctrl.approveReview(mkReq({ params:{ importId: c.importLog.import_id }, session:{ adminId: c.adminRow.admin_id } }), r);
  check('redirected to /outcome/', !!r._redirectTo && /\/revaluation\/outcome\//.test(r._redirectTo));
  const evs = await RevaluationResult.findAll({ where:{ subject_result_id: c.srs.map(s => s.subject_result_id) } });
  check('2 events created', evs.length === 2);
  // Verify the ImportLog imported_records count was updated by approveReview
  // (3 accepts total: 2 regular + 1 unmatched in this test fixture)
  const updatedLog = await ImportLog.findByPk(c.importLog.import_id);
  check('imported_records updated after approval', updatedLog && updatedLog.imported_records === 3);
  const ev0 = evs.find(e => Number(e.subject_result_id) === Number(c.srs[0].subject_result_id));
  const ev1 = evs.find(e => Number(e.subject_result_id) === Number(c.srs[1].subject_result_id));
  check('ev0 is_effective', !!(ev0 && ev0.is_effective));
  check('ev0 revised_marks=80', !!(ev0 && Number(ev0.revised_marks) === 80));
  check('ev0 original_marks=90', !!(ev0 && Number(ev0.original_marks) === 90));
  check('ev1 is_effective', !!(ev1 && ev1.is_effective));
  check('ev1 revised_marks=29', !!(ev1 && Number(ev1.revised_marks) === 29));
  check('ev1 original_marks=25', !!(ev1 && Number(ev1.original_marks) === 25));
  c.revalIds = evs.map(e => e.revaluation_id);
}

async function step7(c) {
  console.log('\n[7] double approval no duplicate events');
  const r = mkRes();
  await ctrl.approveReview(mkReq({ params:{ importId: c.importLog.import_id }, session:{ adminId: c.adminRow.admin_id } }), r);
  check('second approval redirects', !!r._redirectTo && /\/revaluation\/outcome\//.test(r._redirectTo));
  const evs2 = await RevaluationResult.findAll({ where:{ subject_result_id: c.srs.map(s => s.subject_result_id) } });
  check('still 2 events', evs2.length === 2);
  for(const e of evs2){ if(!c.revalIds.includes(e.revaluation_id)) c.revalIds.push(e.revaluation_id); }
}

async function step8(c) {
  console.log('\n[8] runExtraction clears saved.review');
  const ocrId = c.ocr.extraction_id;
  const [rows] = await OcrExtraction.sequelize.query('SELECT extracted_json FROM ocr_extractions WHERE extraction_id = ?', { replacements: [ocrId] });
  const saved = (rows[0] && typeof rows[0].extracted_json === 'string') ? JSON.parse(rows[0].extracted_json) : rows[0].extracted_json;
  saved.ocr.extraction_status = 'pending';
  await OcrExtraction.sequelize.query('UPDATE ocr_extractions SET extracted_json = ? WHERE extraction_id = ?', { replacements: [JSON.stringify(saved), ocrId] });
  await c.importLog.update({ status: 'pending' });
  const reqRun = mkReq({ params:{ importId: c.importLog.import_id }, session:{ adminId: c.adminRow.admin_id } });
  const resRun = mkRes();
  await ctrl.runExtraction(reqRun, resRun);
  const after = (await OcrExtraction.findByPk(ocrId)).extracted_json || {};
  check('saved.review cleared after runExtraction', after.review == null);
}

async function step9(c) {
  console.log('\n[9] PROMPT-14 regression: out-of-range regular marks still rejected');
  const frozenBefore = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const propBefore = ((frozenBefore.extracted_json || {}).review || {}).proposal || [];
  const row0Before = propBefore.find(p => Number(p.subject_result_id) === Number(c.srs[0].subject_result_id));
  if (!row0Before) { check('prior row0 exists', false); return; }
  const body = {};
  body['decision_'+c.srs[0].subject_result_id] = 'accept';
  body['internal_'+c.srs[0].subject_result_id] = '999';
  body['external_'+c.srs[0].subject_result_id] = '50';
  body['decision_'+c.srs[1].subject_result_id] = 'accept';
  body['internal_'+c.srs[1].subject_result_id] = '19';
  body['external_'+c.srs[1].subject_result_id] = '10';
  const r = mkRes();
  await ctrl.submitReview(mkReq({ params:{ importId: c.importLog.import_id }, body, session:{ adminId: c.adminRow.admin_id } }), r);
  check('re-rendered on out-of-range regular marks', !!r._rendered && r._rendered.view === 'revaluation/review');
  const frozenAfter = await OcrExtraction.findByPk(c.ocr.extraction_id);
  const propAfter = ((frozenAfter.extracted_json || {}).review || {}).proposal || [];
  const row0After = propAfter.find(p => Number(p.subject_result_id) === Number(c.srs[0].subject_result_id));
  check('row0 marks unchanged after failed edit', row0After && row0After.proposed_revised_internal_marks === row0Before.proposed_revised_internal_marks);
}


(async () => {
  let created;
  try {
    created = await buildFixtures();
    await step1(created);
    await step2(created);
    await step3(created);
    await step4(created);
    await step5(created);
    // step9 must run BEFORE step6 (approval) since post-approval submitReview redirects to outcome.
    await step9(created);
    await step6(created);
    await step7(created);
    await step8(created);
    console.log('\n==== PROMPT 15: ' + pass + ' passed, ' + fail + ' failed ====');
  } catch (err) {
    console.error('FATAL:', err.message);
    console.error(err.stack);
    fail++;
    console.log('\n==== PROMPT 15: ' + pass + ' passed, ' + fail + ' failed ====');
  } finally {
    if (created) {
      for (const id of created.revalIds) { try { await RevaluationResult.destroy({ where: { revaluation_id: id } }); } catch (_) {} }
      try { await OcrExtraction.destroy({ where: { extraction_id: created.ocr.extraction_id } }); } catch (_) {}
      try { await ImportLog.destroy({ where: { import_id: created.importLog.import_id } }); } catch (_) {}
      for (const sr of created.srs) { try { await SubjectResult.destroy({ where: { subject_result_id: sr.subject_result_id } }); } catch (_) {} }
      if (created.extraSr) { try { await SubjectResult.destroy({ where: { subject_result_id: created.extraSr.subject_result_id } }); } catch (_) {} }
      for (const s of created.subjects) { try { await Subject.destroy({ where: { subject_id: s.subject_id } }); } catch (_) {} }
      try { await Student.destroy({ where: { student_id: created.student.student_id } }); } catch (_) {}
      try { await Result.destroy({ where: { result_id: created.result.result_id } }); } catch (_) {}
      try { await ResultSession.destroy({ where: { session_id: created.session.session_id } }); } catch (_) {}
      try { await Batch.destroy({ where: { batch_id: created.batch.batch_id } }); } catch (_) {}
      try { await AdminUser.destroy({ where: { admin_id: created.adminRow.admin_id } }); } catch (_) {}
    }
  }
  process.exit(fail > 0 ? 1 : 0);
})();
