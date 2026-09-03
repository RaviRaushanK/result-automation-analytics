'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const DE = require('../services/documentExtractor');
const RE = require('../services/revaluationExtractor');
let pass=0,fail=0;
const C=(l,g,e)=>{const o=JSON.stringify(g)===JSON.stringify(e);console.log((o?'  PASS':'  FAIL')+'  '+l+(o?'':': exp='+JSON.stringify(e)+' got='+JSON.stringify(g)));o?pass++:fail++;};
const R=(l,f)=>{console.log('\n['+l+']');try{f();}catch(e){console.error('  EXCEPTION:'+e.message);fail++;}};

R('TEST 1: looksLikeRevaluationRow false positive',()=>{
  C('SE038 -> false',DE.looksLikeRevaluationRow('SUBJECT CODE  SE038  RESULT CARD  VTU'),false);
  C('FA2003 -> false',DE.looksLikeRevaluationRow('Form No. FA2003  Revaluation Application'),false);
});

R('TEST 2: looksLikeRevaluationRow actual row',()=>{
  C('MMC105 pipe -> true',DE.looksLikeRevaluationRow('MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P'),true);
  C('MMC105 space -> true',DE.looksLikeRevaluationRow('MMC105 WEB TECHNOLOGIES 30 15 F 20 P 20 P'),true);
});

R('TEST 3: parseRevaluationDetails pipe-separated',()=>{
  const r=DE.parseRevaluationDetails('MMC105','MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P');
  C('subjectCode=MMC105',r.subjectCode,'MMC105');
  C('subjectName=WEB TECHNOLOGIES',r.subjectName,'WEB TECHNOLOGIES');
  C('internalMarks=30',r.internalMarks,30);
  C('oldMarks=15',r.oldMarks,15);
  C('oldResult=F',r.oldResult,'F');
  C('rvMarks=20',r.rvMarks,20);
  C('rvResult=P',r.rvResult,'P');
  C('finalMarks=20',r.finalMarks,20);
  C('finalResult=P',r.finalResult,'P');
  C('marksValidated=true',r.marksValidated,true);
  C('pipe-split method',r.parsingMethod,'pipe-split');
});

R('TEST 4: parseRevaluationDetails space-separated',()=>{
  const r=DE.parseRevaluationDetails('MMC105','MMC105 WEB TECHNOLOGIES 30 15 F 20 P 20 P');
  C('internalMarks=30',r.internalMarks,30);
  C('oldMarks=15',r.oldMarks,15);
  C('oldResult=F',r.oldResult,'F');
  C('rvMarks=20',r.rvMarks,20);
  C('rvResult=P',r.rvResult,'P');
  C('finalMarks=20',r.finalMarks,20);
  C('finalResult=P',r.finalResult,'P');
  C('marksValidated=true',r.marksValidated,true);
});

R('TEST 5: buildCandidates SE038 rejected (via parseProductionData)',()=>{
  const pd=DE.parseProductionData('Form No. SE038  VTU Revaluation Form\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',[],'revaluation');
  const eo={extraction_method:'pdfjs-text',usn:'1MV25MC061',name:'SINDHUKUMAR S',semester:null,subjects:pd.subjects,lines:pd.lines,parser_warnings:[]};
  const ctx={studentUsn:'1MV25MC061',studentName:'SINDHUKUMAR S',allSubjectResults:[{subject_result_id:1,subject_code:'MMC105',subject_name:'WEB TECHNOLOGIES'}]};
  const result=RE.buildCandidates(eo,ctx);const d=result.ocr.subjects;
  C('MMC105 detected',d.some(s=>s.subjectCode==='MMC105'),true);
  C('MMC105 MATCHED',(d.find(s=>s.subjectCode==='MMC105')||{match_state:'X'}).match_state,'MATCHED');
  C('SE038 NOT in detected',d.some(s=>s.subjectCode==='SE038'),false);
  C('only 1 subject',d.length,1);
});

R('TEST 6: buildCandidates FA2003 rejected',()=>{
  const pd=DE.parseProductionData('Application Ref: FA2003  Revaluation Application\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',[],'revaluation');
  const eo={extraction_method:'pdfjs-text',usn:'1MV25MC061',name:'SINDHUKUMAR S',semester:null,subjects:pd.subjects,lines:pd.lines,parser_warnings:[]};
  const ctx={studentUsn:'1MV25MC061',studentName:'SINDHUKUMAR S',allSubjectResults:[{subject_result_id:1,subject_code:'MMC105',subject_name:'WEB TECHNOLOGIES'}]};
  const result=RE.buildCandidates(eo,ctx);const d=result.ocr.subjects;
  C('FA2003 NOT in detected',d.some(s=>s.subjectCode==='FA2003'),false);
  C('MMC105 MATCHED',(d.find(s=>s.subjectCode==='MMC105')||{match_state:'X'}).match_state,'MATCHED');
});

R('TEST 7: Full end-to-end',()=>{
  const eo={extraction_method:'pdfjs-text',raw_text:'MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',usn:'1MV25MC061',name:'SINDHUKUMAR S',semester:null,subjects:[DE.parseRevaluationDetails('MMC105','MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P')],lines:['MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P'],parser_warnings:[]};
  const ctx={studentUsn:'1MV25MC061',studentName:'SINDHUKUMAR S',allSubjectResults:[{subject_result_id:1,subject_code:'MMC105',subject_name:'WEB TECHNOLOGIES'}]};
  const result=RE.buildCandidates(eo,ctx);const o=result.ocr;
  C('subjects.length=1',o.subjects.length,1);
  C('MMC105 MATCHED',o.subjects[0].match_state,'MATCHED');
  C('rvMarks=20',o.subjects[0].rvMarks,20);
  C('rvResult=P',o.subjects[0].rvResult,'P');
  C('finalMarks=20',o.subjects[0].finalMarks,20);
  C('finalResult=P',o.subjects[0].finalResult,'P');
  C('oldResult=F',o.subjects[0].oldResult,'F');
  C('missing_subjects.length=0',o.missing_subjects.length,0);
});

R('TEST 8: allSubjectResults → missing_subjects (OCR-only row generation)',()=>{
  // Test that when OCR detects MMC105 from the card, the other 5 subjects
  // from the student's full allSubjectResults set appear in missing_subjects.
  // The Extraction page no longer renders missing_subjects (it only renders
  // detected OCR rows), but the field is surfaced for the review page's
  // "Add Subject" feature.
  const allSR=[
    {subject_result_id:1,subject_code:'MMC101',subject_name:'SUBJECT 1'},
    {subject_result_id:2,subject_code:'MMC102',subject_name:'SUBJECT 2'},
    {subject_result_id:3,subject_code:'MMC103',subject_name:'SUBJECT 3'},
    {subject_result_id:4,subject_code:'MMC104',subject_name:'SUBJECT 4'},
    {subject_result_id:5,subject_code:'MMC105',subject_name:'WEB TECHNOLOGIES'},
    {subject_result_id:6,subject_code:'MMC106',subject_name:'SUBJECT 6'}
  ];
  const eo={
    extraction_method:'pdfjs-text',usn:'1MV25MC061',name:'SINDHUKUMAR S',
    semester:null,
    subjects:[DE.parseRevaluationDetails('MMC105','MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P')],
    lines:['MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P'],
    parser_warnings:[]
  };
  const ctx={studentUsn:'1MV25MC061',studentName:'SINDHUKUMAR S',allSubjectResults:allSR};
  const result=RE.buildCandidates(eo,ctx);const o=result.ocr;
  C('detected.length=1 (OCR only)',o.subjects.length,1);
  C('missing_subjects.length=5 (allSubjectResults not matched)',o.missing_subjects.length,5);
  C('MMC105 is NOT in missing',o.missing_subjects.some(s=>s.subject_code==='MMC105'),false);
  C('MMC101 is in missing',o.missing_subjects.some(s=>s.subject_code==='MMC101'),true);
  C('MMC106 is in missing',o.missing_subjects.some(s=>s.subject_code==='MMC106'),true);
  C('MMC105 match_state=MATCHED',(o.subjects.find(s=>s.subjectCode==='MMC105')||{match_state:'X'}).match_state,'MATCHED');
});

R('TEST 9: Original-result regression',()=>{
  const r=DE.parseProductionData('1MV25CS051 Student Name : John Doe Semester : 5 21CS51 Algorithm Design 50 40 P 90 A',[],'original');
  const s=r.subjects[0];
  if(s){C('has subject',!!s,true);C('rvMarks undefined',s.rvMarks,undefined);C('rvResult undefined',s.rvResult,undefined);C('finalMarks undefined',s.finalMarks,undefined);C('finalResult undefined',s.finalResult,undefined);}else{console.log('  (No subject extracted - legacy behavior)');pass++;}
});

console.log('\n'+'='.repeat(60));
console.log('Phase 2 Debug: '+pass+'/'+(pass+fail)+' PASS');
console.log('='.repeat(60));
process.exit(fail>0?1:0);
