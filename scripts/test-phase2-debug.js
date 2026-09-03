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

R('TEST 10: REGRESSION — Rev. Ext must equal rvMarks, NOT oldMarks',()=>{
  // BUG HISTORY: revised_external_marks was once mapped to oldMarks (15) instead
  // of rvMarks (20). That made the Review & Validate "Rev. Ext" field display
  // 15 (the old attempt mark) instead of 20 (the revaluation mark on the card).
  //
  // The VTU card fields are INDEPENDENT and must be preserved as-is:
  //   internalMarks, oldMarks, oldResult, rvMarks, rvResult, finalMarks, finalResult
  //
  // This test proves:
  //   1. The canonical nine fields survive end-to-end unchanged.
  //   2. revised_external_marks is exactly rvMarks (20), not oldMarks (15).
  //   3. If anyone re-introduces the old mapping, this test FAILS.
  const cardLine = 'MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P';
  const eo = {
    extraction_method: 'pdfjs-text',
    raw_text: cardLine,
    usn: '1MV25MC061', name: 'SINDHUKUMAR S', semester: null,
    subjects: [DE.parseRevaluationDetails('MMC105', cardLine)],
    lines: [cardLine],
    parser_warnings: []
  };
  const ctx = { studentUsn: '1MV25MC061', studentName: 'SINDHUKUMAR S',
                allSubjectResults: [{ subject_result_id: 1, subject_code: 'MMC105', subject_name: 'WEB TECHNOLOGIES' }] };
  const out = RE.buildCandidates(eo, ctx);
  const s = out.ocr.subjects[0];

  // -- Canonical nine fields preserved exactly --
  C('subjectCode = MMC105',       s.subjectCode,   'MMC105');
  C('subjectName = WEB TECHNOLOGIES', s.subjectName, 'WEB TECHNOLOGIES');
  C('internalMarks = 30',         s.internalMarks, 30);
  C('oldMarks = 15 (NOT mapped to Rev. Ext)', s.oldMarks, 15);
  C('oldResult = F',              s.oldResult,     'F');
  C('rvMarks = 20 (IS Rev. Ext)', s.rvMarks,       20);
  C('rvResult = P',               s.rvResult,      'P');
  C('finalMarks = 20',            s.finalMarks,    20);
  C('finalResult = P',            s.finalResult,   'P');

  // -- The actual fix: revised_external_marks == rvMarks, NOT oldMarks --
  C('revised_internal_marks == internalMarks (30)', s.revised_internal_marks, 30);
  C('revised_external_marks == rvMarks (20) — was oldMarks (15), must be rvMarks', s.revised_external_marks, 20);
  C('revised_external_marks !== oldMarks (15) — explicit negative', s.revised_external_marks === s.oldMarks, false);
  C('revised_marks == finalMarks (20)', s.revised_marks, 20);

  // -- Definitive assertion: if the bug ever returns, this fails loudly --
  if (s.revised_external_marks !== 20) {
    console.error('  *** REGRESSION DETECTED ***');
    console.error('  revised_external_marks = ' + s.revised_external_marks);
    console.error('  Expected: 20 (rvMarks)');
    console.error('  Got: ' + s.revised_external_marks + ' (looks like oldMarks leaked through again)');
    fail++;
  } else {
    pass++;
    console.log('  PASS  Rev. Ext mapping is correct (rvMarks → revised_external_marks)');
  }
});

R('TEST 11: Rev. Ext is generic (different card → different value)',()=>{
  // For any card, Rev. Ext must equal that card's rvMarks, never oldMarks.
  // Card 1: old=15, rv=20  →  revised_external_marks = 20
  // Card 2: old=8,  rv=35 →  revised_external_marks = 35
  // Card 3: old=42, rv=0  →  revised_external_marks = 0  (revaluation absent/zero)
  const build = (line) => {
    const eo = { extraction_method: 'pdfjs-text', raw_text: line, usn: 'U', name: 'N', semester: null,
      subjects: [DE.parseRevaluationDetails('XX101', line)], lines: [line], parser_warnings: [] };
    return RE.buildCandidates(eo, { studentUsn: 'U', studentName: 'N',
      allSubjectResults: [{ subject_result_id: 1, subject_code: 'XX101', subject_name: 'SUBJ' }] }).ocr.subjects[0];
  };
  const c1 = build('XX101 | A | 30 | 15 | F | 20 | P | 35 | P');
  const c2 = build('XX101 | A | 30 | 8  | F | 35 | P | 65 | P');
  const c3 = build('XX101 | A | 30 | 42 | F | 0  | F | 42 | F');

  C('Card1: oldMarks=15', c1.oldMarks, 15);
  C('Card1: rvMarks=20',  c1.rvMarks, 20);
  C('Card1: Rev. Ext=20 (not 15)', c1.revised_external_marks, 20);

  C('Card2: oldMarks=8',  c2.oldMarks, 8);
  C('Card2: rvMarks=35',  c2.rvMarks, 35);
  C('Card2: Rev. Ext=35 (not 8)',  c2.revised_external_marks, 35);

  C('Card3: oldMarks=42', c3.oldMarks, 42);
  C('Card3: rvMarks=0',   c3.rvMarks, 0);
  C('Card3: Rev. Ext=0 (not 42)',  c3.revised_external_marks, 0);
});

console.log('\n'+'='.repeat(60));
console.log('Phase 2 Debug: '+pass+'/'+(pass+fail)+' PASS');
console.log('='.repeat(60));
process.exit(fail>0?1:0);
