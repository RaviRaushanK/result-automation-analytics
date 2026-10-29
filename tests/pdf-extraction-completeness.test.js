'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const pdfAdmission = require('../services/pdfAdmission');


for (const examType of ['REGULAR','BACKLOG','SUPPLEMENTARY','REPEAT', undefined, '', null]) {
  test(String(examType) + (['REGULAR', 'BACKLOG'].includes(examType) ? ' upload supplies the appropriate completeness scope without academic writes' : ' upload rejects an unavailable or missing exam type before extraction'),async()=>{
    let options,staged;
    const subjects=[{subject_id:1,subject_code:'MMC101',subject_name:'COURSE',credits:4},{subject_id:2,subject_code:'MMCL106',subject_name:'LAB',credits:2}];
    const forbidden=()=>assert.fail('Academic results must not be written during extraction');
    const models={
      Subject:{findAll:async()=>subjects},Result:{create:forbidden},SubjectResult:{bulkCreate:forbidden},
      ImportLog:{create:async()=>({import_id:9,update:async()=>{}})},
      OcrExtraction:{create:async values=>{staged=values;}}
    };
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/resultController.js'),'utf8'),{
      module,exports:module.exports,__dirname:path.join(__dirname,'../controllers'),console,
      require(name){
        if(name==='../database/models')return models;
        if(name==='fs')return {existsSync:()=>true,renameSync(){}};
        if(name==='../services/documentExtractor')return {extract:async(file,type,opts)=>{
          options=opts;
          return {extraction:{student:{usn:'1MV25MC061',name:'TEST STUDENT'},subjects:[{subjectCode:'MMCL106',internalMarks:48,externalMarks:49,marksConfidence:'high'}, {subjectCode:'MMC201',internalMarks:40,externalMarks:30}]}};
        }};
        return require(name);
      }
    });
    let location;
    await module.exports.processUpload({body:{exam_session_id:'1',attempt_no:examType === 'BACKLOG' ? '2' : '1',exam_type:examType},file:{path:'staged.pdf',originalname:'card.pdf'},session:{adminId:1}},{redirect:url=>{location=url;}});
    if (!['REGULAR', 'BACKLOG'].includes(examType)) {
      assert.match(location, /\/results\/upload\?error=/);
      assert.match(decodeURIComponent(location), examType ? /REGULAR, BACKLOG/ : /Exam Type is required/);
      assert.equal(staged, undefined);
      assert.equal(options, undefined);
      return;
    }
    assert.equal(location,'/results/upload/9/review');
    assert.equal(JSON.stringify(options.expectedSubjectCodes),JSON.stringify(examType==='REGULAR'?['MMC101','MMCL106']:[]));
    const lab=staged.extracted_json.subjects.find(row=>row.subject_code==='MMCL106');
    assert.equal(lab.internalMarks,48);assert.equal(lab.externalMarks,49);
    assert.equal(staged.validation_status,'pending');
    assert.equal(JSON.stringify(staged.extracted_json.excluded_subjects), JSON.stringify([{subject_code:'MMC201',subject_name:''}]));
    assert.ok(!staged.extracted_json.subjects.some(row=>row.subject_code==='MMC201'));
  });
}
for (const examType of ['REGULAR', 'BACKLOG']) {
  for (const kind of ['text', 'scope', 'generic']) {
    const controlled = kind !== 'generic';
    test(`${examType} extraction rejection retains failed lifecycle and ${kind} upload alert`, async () => {
      const pages = kind === 'scope' ? [[...identity, 'MMC101 COURSE 40 40 80 P'], [], [], []] : Array.from({length:4}, () => []);
      const { extractor, state } = fixture([], false, pages);
      if (!controlled) extractor.extract = async () => { throw new Error('private provider failure'); };
      let log, extractionCreated = false, moves = 0;
      const warnings = [], errors = [];
      const forbidden = () => assert.fail('Rejection must not write academic data');
      const academic = {create:forbidden, update:forbidden, bulkCreate:forbidden, destroy:forbidden};
      const models = {
        Student: academic, Result: academic, SubjectResult: academic, RevaluationResult: academic,
        Batch: {findAll:async()=>[]}, ExamSession: {findAll:async()=>[]},
        Subject: {findAll:async()=>kind === 'scope' ? [{subject_code:'MMC999'}] : []},
        ImportLog: {create:async values => (log = {...values, import_id:9, update:async values=>Object.assign(log,values)})},
        OcrExtraction: {create:async()=>{extractionCreated=true;assert.fail('Rejected original extraction cannot create an OCR draft');}}
      };
      const module = {exports:{}};
      vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/resultController.js'),'utf8'), {
        module,exports:module.exports,__dirname:path.join(__dirname,'../controllers'),console:{log(){},warn(message){warnings.push(message);},error(message){errors.push(message);}},
        require(name) {
          if(name==='../database/models')return models;
          if(name==='../services/documentExtractor')return extractor;
          if(name==='fs')return {existsSync:()=>true,renameSync(){moves++;},unlinkSync:()=>assert.fail('Retain failed extraction file')};
          return require(name);
        }
      });
      let location;
      await module.exports.processUpload({body:{exam_session_id:'1',exam_type:examType,attempt_no:examType==='REGULAR'?'1':'2'},
        file:{path:'staged.pdf',originalname:'unsupported.pdf'},session:{adminId:1}}, {redirect:url=>{location=url;}});
      const back = new URL(location,'http://localhost');
      assert.equal(back.pathname,'/results/upload');
      assert.equal(log.status,'failed'); assert.equal(moves,1); assert.equal(extractionCreated,false);
      assert.ok(log.file_path.endsWith('.pdf'));
      let locals;
      await module.exports.showUploadPage({query:Object.fromEntries(back.searchParams)}, {render(view,data){assert.equal(view,'results/upload');locals=data;}});
      const html = await ejs.renderFile(path.join(__dirname,'../views/results/upload.ejs'),locals);
      assert.match(html,/alert alert-danger/);
      if (controlled) {
        const publicError = kind === 'scope'
          ? pdfAdmission.publicError(new pdfAdmission.PdfSubjectScopeError(4, examType === 'REGULAR' ? ['MMC999'] : [], true))
          : pdfAdmission.publicError(new pdfAdmission.LongPdfTextRequiredError(4));
        assert.equal(back.searchParams.get('error_code'),publicError.code);
        assert.equal(locals.error,publicError.message);
        assert.equal(locals.errorTitle,publicError.title);
        for (const paragraph of publicError.message.split('\n\n')) assert.ok(html.includes(paragraph));
        assert.equal(locals.selectedSessionId,'1');
        assert.equal(locals.selectedExamType,examType);
        assert.equal(locals.selectedAttemptNo,examType === 'REGULAR' ? '1' : '2');
        assert.equal(warnings.length,1); assert.equal(errors.length,0);
        if (kind === 'scope') assert.doesNotMatch(html,/Selectable\/OCR text required|Image-only scanned PDFs are currently supported/);
        assert.equal(state.aiCalls,0); assert.equal(state.sparseCalls,0);
      } else {
        assert.equal(back.searchParams.get('error_code'),null);
        assert.match(locals.error,/The document could not be extracted/);
        assert.doesNotMatch(html,/private provider failure|Selectable\/OCR text required/);
      }
    });
  }
}

const identity = ['University Seat Number : 1MV25MC061','Student Name : TEST STUDENT','Semester : 1'];
const rows = [
  'MMC101 PROGRAMMING AND 50 36 86 P 2026-04-28', 'PROBLEM SOLVING IN C',
  'MMC102 DISCRETE MATHEMATICS 47 32 79 P 2026-04-28', 'AND GRAPH THEORY',
  'MMC103 DATABASE 48 25 73 P 2026-04-28', 'MANAGEMENT SYSTEMS (DBMS)',
  'MMC104 OPERATING SYSTEM 43 30 73 P 2026-04-28',
  'MMC105 WEB TECHNOLOGIES 49 35 84 P 2026-04-28',
  'MMCL106 DBMS AND WEB 48 49 97 P 2026-04-28', 'TECHNOLOGIES', 'LABORATORY'
];
function fixture(lines = [...identity,...rows], cacheContents = false, readerPages = null) {
  const state = { aiCalls:0, pdfCalls:0, ocrCalls:0, pageCalls:0, configured:true, mode:'auto', aiThrows:false, pdfThrows:false,
    pdfLines: lines, contents: Buffer.from('synthetic PDF contents'), pageCount: 1, sparseCalls: 0, actualPageReads: [] };
  const module = {exports:{}};
  const aiResult = { success:true, extraction:{extractionMethod:'test-ai',subjects:[]} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/documentExtractor.js'),'utf8'), {
    module, exports:module.exports, console:{log(){},warn(){},error(){}},
    process:{env:{get EXTRACTION_MODE(){return state.mode;}}},
    require(name) {
      if(name==='fs')return {existsSync:()=>true, ...(cacheContents || readerPages ? { readFileSync:()=>state.contents } : {})};
      if(name==='./pdfAdmission')return pdfAdmission;
      if(name==='pdfjs-dist/legacy/build/pdf.mjs' && readerPages)return {getDocument:()=>({promise:Promise.resolve({
        numPages:readerPages.length,
        getPage:async page=>{
          state.actualPageReads.push(page);
          if(state.readerErrorAt === page)throw new Error('Page text unavailable');
          return {getTextContent:async()=>({items:readerPages[page-1].map((str,i)=>({str,
            transform:[1,0,0,1,20,800-i*30],width:450,height:12}))})};
        }
      })})};
      if(name==='./aiProviders')return {isConfigured:()=>state.configured};
      if(name==='./pageRenderer')return {renderPdfToImages:async()=>{state.pageCalls++;return [{buffer:Buffer.from('rendered page')}];}};
      if(name==='./vlmExtractor')return {extract:async()=>{state.aiCalls++;if(state.aiThrows)throw new Error('AI unavailable');return aiResult;}};
      return require(name);
    }
  });
  const extractor=module.exports;
  extractor.extractSparseRows=async()=>{state.sparseCalls++;return state.sparseOutput ?? null;};
  if (!readerPages) extractor.extractPdfTextWithCoordinates=async()=>{
    state.pdfCalls++;
    if(state.pdfThrows)throw Object.assign(new Error('No readable PDF text'), {pageCount:state.pageCount});
    return {text:state.pdfLines.join('\n'),words:state.pdfLines.map((text,i)=>({text,x:0,y:i*30,page:1,height:12})), pageCount:state.pageCount};
  };
  extractor.ocrImage=async()=>{state.ocrCalls++;return {text:state.ocrText ?? [...identity,...rows].join('\n'),words:[]};};
  return {extractor,state,aiResult};
}

test('an admitted long imperfect PDF reaches review and existing validation blocks its missing marks without academic writes', async () => {
  const { extractor } = fixture([], false, [[...identity,'MMC101 COURSE 40 40 80 P'],['MMCL106 LAB ?? 30 ?? P'],[],[],[]]);
  const session = {exam_session_id:1,batch_id:1,semester:'1',exam_session:'Jun',exam_year:2026,Batch:{batch_name:'TEST BATCH'}};
  const definitions = ['MMC101','MMCL106'].map((code,i)=>({subject_id:i+1,course_id:i+1,subject_code:code,subject_name:'COURSE',subject_type:'theory',credits:4,max_internal:50,max_external:50,max_marks:100}));
  let log, ocr;
  const forbidden = () => assert.fail('Review/failed validation must not write academic records');
  const models = {
    ImportLog:{create:async values=>(log={...values,import_id:9,ExamSession:session,update:async data=>Object.assign(log,data)}),findByPk:async()=>log},
    OcrExtraction:{create:async values=>(ocr={...values,update:async data=>Object.assign(ocr,data)}),findOne:async()=>ocr},
    Subject:{findAll:async()=>definitions},
    AcademicCourse:{findAll:async()=>definitions.map(row=>({...row,status:'active',is_required:true,roster_verified:true,semester:'1'}))},
    Student:{findOne:async()=>({student_id:1,batch_id:1,usn:'1MV25MC061',student_name:'TEST STUDENT'}),create:forbidden,update:forbidden},
    Result:{findOne:async()=>null,create:forbidden,update:forbidden},SubjectResult:{bulkCreate:forbidden,update:forbidden},RevaluationResult:{create:forbidden,update:forbidden}
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/resultController.js'),'utf8'),{
    module,exports:module.exports,__dirname:path.join(__dirname,'../controllers'),console:{log(){},warn(){},error(){}},
    require(name){
      if(name==='../database/models')return models;
      if(name==='../services/documentExtractor')return extractor;
      if(name==='../services/resultHistoryService')return {validationError:async()=>null};
      if(name==='../services/academicOutcomeService')return {retakeWarnings:async()=>[]};
      if(name==='fs')return {existsSync:()=>true,renameSync(){}};
      return require(name);
    }
  });
  let location;
  await module.exports.processUpload({body:{exam_session_id:'1',exam_type:'REGULAR',attempt_no:'1'},
    file:{path:'staged.pdf',originalname:'imperfect.pdf'},session:{adminId:1}}, {redirect:url=>{location=url;}});
  assert.equal(location,'/results/upload/9/review'); assert.equal(log.status,'extracted');
  assert.equal(ocr.extracted_json.subjects[1].internalMarks,'');
  const response={statusCode:200,status(code){this.statusCode=code;return this;},render(view,locals){this.view=view;this.locals=locals;},redirect:url=>assert.fail(url)};
  await module.exports.validateReview({params:{importId:'9'},session:{adminId:1},body:{
    usn:'1MV25MC061',name:'TEST STUDENT',internal_1:'40',external_1:'40',internal_2:'',external_2:'',
    exam_type:'REGULAR',attempt_no:'1',verify_usn:'1',verify_semester:'1',verify_period:'1'
  }},response);
  assert.equal(response.statusCode,422); assert.equal(response.view,'results/review');
  assert.match(JSON.stringify(response.locals.errors),/marks are required/);
  assert.equal(ocr.validation_status,'pending');
});

test('five-page valid text PDF reads every page and bypasses all raster and AI paths', async () => {
  const pages = Array.from({length:5}, (_, i) => [...(i === 0 ? identity : []), `MMC10${i+1} COURSE 40 40 80 P`]);
  const { extractor, state } = fixture([], false, pages);
  const result = await extractor.extract('long-text.pdf', 'original', {
    expectedSubjectCodes: ['MMC101','MMC102','MMC103','MMC104','MMC105']
  });
  assert.equal(result.extraction.extractionMethod, 'pdfjs-text');
  assert.equal(result.extraction.pageCount, 5);
  assert.deepEqual(state.actualPageReads, [1,2,3,4,5]);
  assert.equal(JSON.stringify(result.extraction.subjects.map(row => row.subjectCode)), JSON.stringify(['MMC101','MMC102','MMC103','MMC104','MMC105']));
  for (const counter of ['aiCalls','ocrCalls','pageCalls','sparseCalls']) assert.equal(state[counter], 0, counter);
});

test('all-page text reader returns total count and unchanged page coordinates', async () => {
  const { extractor } = fixture([], false, [['HEADER'], [], [], ['LATER TEXT']]);
  const result = await extractor.extractPdfTextWithCoordinates('coordinates.pdf');
  assert.equal(result.pageCount, 4);
  assert.equal(result.text, 'HEADER \n\n\nLATER TEXT');
  assert.equal(JSON.stringify(result.words.map(word => ({text:word.text,page:word.page,x:word.x,y:word.y}))),
    JSON.stringify([{text:'HEADER',page:1,x:20,y:200},{text:'LATER TEXT',page:4,x:20,y:200}]));
});

test('two meaningful text pages followed by two blank pages are accepted without rasterization', async () => {
  const { extractor, state } = fixture([], false, [
    [...identity, 'MMC101 COURSE 40 40 80 P'], ['MMCL106 LAB 30 30 60 P'], [], []
  ]);
  const result = await extractor.extract('blank-tail.pdf','original',{candidateSubjectCodes:['MMC101','MMCL106']});
  assert.equal(result.extraction.extractionMethod,'pdfjs-text');
  assert.equal(result.extraction.pageCount,4);
  assert.equal(result.extraction.subjects.length,2);
  assert.deepEqual(state.actualPageReads,[1,2,3,4]);
  for (const counter of ['aiCalls','ocrCalls','pageCalls','sparseCalls']) assert.equal(state[counter],0,counter);
});

for (const [problem, row] of [
  ['missing printed result', 'MMC102 COURSE 30 20 50'],
  ['uncertain mark', 'MMC102 COURSE ?? 20 ?? F'],
  ['inconsistent printed total', 'MMC102 COURSE 30 20 49 F']
]) {
  test('five-page text with ' + problem + ' keeps all rows for review and never calls OCR/VLM', async () => {
    const { extractor, state } = fixture([], false, [
      [...identity, 'Subject Code Subject Name Internal External Total Result', 'MMC101 COURSE 40 40 80 P'],
      [], [row], [], ['MMCL106 LAB 30 30 60 P']
    ]);
    const result = await extractor.extract('imperfect-text.pdf','original',{
      expectedSubjectCodes:['MMC101','MMC102','MMCL106'],candidateSubjectCodes:['MMC101','MMC102','MMCL106']
    });
    assert.equal(result.extraction.extractionMethod,'pdfjs-text');
    assert.equal(result.extraction.subjects.length,3);
    assert.ok(result.extraction.rawText.includes(row));
    assert.equal(extractor.hasCompleteTextRows(result.extraction),false);
    assert.deepEqual(state.actualPageReads,[1,2,3,4,5]);
    for (const counter of ['aiCalls','ocrCalls','pageCalls','sparseCalls']) assert.equal(state[counter],0,counter);
  });
}

for (const [kind, lines] of [
  ['footer only', ['VTU Result','Page 1 of 5','https://results.example/MSC2026/40/40','10/14/26, 11:54 PM']],
  ['headers without rows', ['Subject Code Subject Name Internal External Total Result','Marks Marks','50 50 100']],
  ['bare subject code', [...identity,'MMC101 COURSE']],
  ['incidental characters', ['ABC2026 10 20 miscellaneous selectable characters']],
  ['identity and incidental date', [...identity,'ABC2026 generated 10/14/26 11:54 PM']],
  ['identity and incidental page number', [...identity,'ABC2026 Page 1 of 5']]
]) {
  test('long ' + kind + ' is not meaningful result-table text', async () => {
    const { extractor, state } = fixture([], false, [lines,[],[],[],[]]);
    await assert.rejects(extractor.extract('incidental.pdf'),{code:pdfAdmission.CODE});
    for (const counter of ['aiCalls','ocrCalls','pageCalls','sparseCalls']) assert.equal(state[counter],0,counter);
  });
}

test('a clear table header admits rows despite missing identity and semester fields for review', async () => {
  const { extractor, state } = fixture([], false, [
    ['Subject Code Subject Name Internal External Total Result','MMC101 COURSE 40 40 80'],[],[],[]
  ]);
  const result = await extractor.extract('missing-identity.pdf');
  assert.equal(result.extraction.extractionMethod,'pdfjs-text');
  assert.equal(result.extraction.student.usn,undefined);
  assert.equal(result.extraction.semester,null);
  assert.ok(result.extraction.warnings.length);
  assert.equal(state.aiCalls,0); assert.equal(state.sparseCalls,0);
});

test('incomplete revaluation cells remain on the text path for ordinary review', async () => {
  const { extractor, state } = fixture([], false, [
    [...identity,'MMC101 COURSE 40 10 F 30 P 30 P'],[],[],[],['MMCL106 LAB 30 15 F 25 P ?? P']
  ]);
  const result = await extractor.extract('partial-revaluation.pdf','revaluation',{candidateSubjectCodes:['MMC101','MMCL106']});
  assert.equal(result.extraction.extractionMethod,'pdfjs-text');
  assert.ok(result.extraction.rawText.includes('??'));
  assert.equal(extractor.hasCompleteTextRows(result.extraction),false);
  assert.equal(state.aiCalls,0); assert.equal(state.sparseCalls,0);
});

for (const mode of ['tesseract', 'auto', 'vlm', 'hybrid']) {
  for (const configured of [false, true]) {
    for (const [kind, pages] of [
      ['four-page image-only', Array.from({length:4}, () => [])],
      ['six-page header-only', Array.from({length:6}, () => ['UNIVERSITY HEADER AND FOOTER: SELECTABLE TEXT WITHOUT ANY RESULT TABLE OR MARKS.'])],
      ['six-page metadata-only', Array.from({length:6}, () => ['DOCUMENT ID ABC2026', 'Generated 2026-10-29 11:54', 'Page 1 of 6'])]
    ]) {
      test(`${kind} rejects before raster/OCR/AI in ${mode}, AI configured=${configured}`, async () => {
        const { extractor, state } = fixture([], false, pages);
        state.mode = mode; state.configured = configured;
        await assert.rejects(extractor.extract('unsupported.pdf'), error => {
          assert.equal(error.code, pdfAdmission.CODE);
          assert.equal(error.message, pdfAdmission.MESSAGE);
          assert.equal(error.pageCount, pages.length);
          return true;
        });
        for (const counter of ['aiCalls','ocrCalls','pageCalls','sparseCalls']) assert.equal(state[counter], 0, counter);
      });
    }
    for (const count of [1,2,3]) {
      test(`${count}-page scan keeps configured ${mode} flow, AI configured=${configured}`, async () => {
        const { extractor, state, aiResult } = fixture([], false, Array.from({length:count}, () => []));
        state.mode = mode; state.configured = configured;
        state.sparseOutput = {extractionMethod:'existing-sparse-path', subjects:[]};
        const result = await extractor.extract('supported.pdf');
        if (configured && mode !== 'tesseract') {
          assert.equal(result, aiResult);
          assert.equal(state.aiCalls, 1);
          assert.equal(state.sparseCalls, 1, 'existing empty-hybrid sparse recovery still runs');
        } else {
          assert.equal(result.extraction, state.sparseOutput);
          assert.equal(state.aiCalls, 0);
          assert.equal(state.sparseCalls, 1);
        }
        assert.deepEqual(state.actualPageReads, Array.from({length:count}, (_, i) => i+1));
      });
    }
  }
}

test('long PDF still requires matching configured subject evidence', async () => {
  const { extractor, state } = fixture([...identity, ...rows]); state.pageCount = 5;
  await assert.rejects(extractor.extract('wrong-roster.pdf', 'original', {candidateSubjectCodes:['MMC999']}), error => {
    assert.equal(error.code,pdfAdmission.SCOPE_CODE);
    assert.equal(error.noMatchingRows,true);
    assert.match(error.message,/No extracted subject rows match/);
    assert.doesNotMatch(error.message,/text layer could not be read/);
    return true;
  });
  assert.equal(state.aiCalls, 0); assert.equal(state.sparseCalls, 0);
});

test('missing required roster coverage remains on text path for review in both regular and backlog scope', async () => {
  const { extractor, state } = fixture([...identity, 'MMC101 COURSE 40 40 80 P']); state.pageCount = 4;
  const regular = await extractor.extract('partial.pdf', 'original', {expectedSubjectCodes:['MMC101','MMCL106'],candidateSubjectCodes:['MMC101','MMCL106']});
  assert.equal(regular.extraction.extractionMethod,'pdfjs-text');
  assert.equal(extractor.hasCompleteTextRows(regular.extraction,['MMC101','MMCL106']),false);
  const result = await extractor.extract('partial.pdf', 'original', {expectedSubjectCodes:[],candidateSubjectCodes:['MMC101','MMCL106']});
  assert.equal(result.extraction.extractionMethod,'pdfjs-text');
  assert.equal(state.aiCalls,0); assert.equal(state.sparseCalls,0);
});

test('uncertain or duplicate native rows with no matching subject codes report scope rather than missing text', async () => {
  for (const lines of [[...identity,'MMC101 COURSE 40 40 79 P'], [...identity,'MMC101 COURSE 40 40 80 P','MMC101 COURSE 40 40 80 P']]) {
    const { extractor, state } = fixture(lines); state.pageCount = 4;
    await assert.rejects(extractor.extract('unusable.pdf','original',{expectedSubjectCodes:['MMC999'],candidateSubjectCodes:['MMC999']}),{code:pdfAdmission.SCOPE_CODE});
    assert.equal(state.aiCalls,0); assert.equal(state.sparseCalls,0);
  }
});

test('a complete five-page revaluation text table retains the shared native fast path', async () => {
  const { extractor, state } = fixture([], false, [
    [...identity, 'MMC101 COURSE 40 10 F 30 P 30 P'], [], [], [], ['MMCL106 LAB 30 15 F 25 P 25 P']
  ]);
  const result = await extractor.extract('revaluation.pdf', 'revaluation', {candidateSubjectCodes:['MMC101','MMCL106']});
  assert.equal(result.extraction.extractionMethod, 'pdfjs-text');
  assert.equal(result.extraction.subjects.length, 2);
  assert.equal(result.extraction.pageCount, 5);
  assert.equal(state.aiCalls, 0); assert.equal(state.sparseCalls, 0);
});

test('a text-read failure on a later long-PDF page cannot fall through to limited OCR', async () => {
  const { extractor, state } = fixture([], false, Array.from({length:5}, () => []));
  state.readerErrorAt = 4;
  await assert.rejects(extractor.extract('unreadable-text.pdf'), {code:pdfAdmission.CODE});
  assert.deepEqual(state.actualPageReads, [1,2,3,4]);
  assert.equal(state.aiCalls, 0); assert.equal(state.pageCalls, 0); assert.equal(state.sparseCalls, 0);
});

test('unknown PDF page count fails closed before raster dispatch', async () => {
  const { extractor, state } = fixture([]);
  state.pdfThrows = true; state.pageCount = undefined;
  await assert.rejects(extractor.extract('unreadable.pdf'), /Could not determine the PDF page count/);
  assert.equal(state.aiCalls, 0); assert.equal(state.sparseCalls, 0);
});

test('wrapped announcement dates retain the complete native table without AI or OCR', async () => {
  const wrapped = rows.flatMap(line => line.includes('2026-04-28') ? [line.replace('2026-04-28', '2026-04-'), '28'] : [line]);
  const { extractor, state } = fixture([...identity, ...wrapped]);
  const output = await extractor.extract('wrapped.pdf', 'original', { expectedSubjectCodes: ['MMC101', 'MMC102', 'MMC103', 'MMC104', 'MMC105', 'MMCL106'] });
  assert.equal(output.extraction.extractionMethod, 'pdfjs-text');
  assert.equal(output.extraction.subjects.length, 6);
  assert.equal(output.extraction.subjects[0].totalMarks, 86);
  assert.equal(state.aiCalls, 0);
  assert.equal(state.ocrCalls, 0);
});

test('a wrapped date cannot hide an extra number from strict validation of admitted text', async () => {
  const { extractor, state, aiResult } = fixture([...identity, 'MMC101 COURSE 7 40 40 80 P 2026-04-', '28']);
  const result = await extractor.extract('ambiguous.pdf');
  assert.equal(result.extraction.extractionMethod,'pdfjs-text');
  assert.equal(extractor.hasCompleteTextRows(result.extraction),false);
  assert.equal(state.aiCalls, 0);
});

test('complete embedded PDF text retains the wrapped last lab row before AI can omit it',async()=>{
  const {extractor,state}=fixture();
  const output=await extractor.extract('card.pdf','original',{expectedSubjectCodes:['MMC101','MMC102','MMC103','MMC104','MMC105','MMCL106']});
  assert.equal(output.extraction.extractionMethod,'pdfjs-text');
  assert.equal(output.extraction.subjects.length,6);
  const last=output.extraction.subjects.find(row=>row.subjectCode==='MMCL106');
  assert.equal(last.internalMarks,48);assert.equal(last.externalMarks,49);assert.equal(last.totalMarks,97);
  assert.equal(state.aiCalls,0);assert.equal(state.ocrCalls,0);assert.equal(state.pdfCalls,1);
});

test('code-like font fragments before a complete subject-table header cannot force AI result readings', async () => {
  const { extractor, state } = fixture(['University HDR123 encoded heading', ...identity,
    'Subject Code Subject Name Internal Marks External Marks Total Result Announced / Updated', ...rows]);
  const output = await extractor.extract('card.pdf', 'original', { expectedSubjectCodes: ['MMC101','MMC102','MMC103','MMC104','MMC105','MMCL106'] });
  assert.equal(output.extraction.extractionMethod, 'pdfjs-text');
  assert.equal(output.extraction.subjects.length, 6);
  assert.equal(output.extraction.subjects.find(row => row.subjectCode === 'MMC102').result, 'P');
  assert.equal(state.aiCalls, 0);
  const evidence = await extractor.readOriginalResultEvidence('card.pdf', ['MMC102']);
  assert.equal(evidence.subjects.find(row => row.subjectCode === 'MMC102').result, 'P');
});

test('table header filtering retains incomplete actual course rows and later mixed-semester tables on the text path', async () => {
  const { extractor, state, aiResult } = fixture([...identity,
    'Subject Code Subject Name Internal Marks External Marks Total Result',
    'MMC101 COURSE 40 40 80 P', 'Semester : 2',
    'Subject Code Subject Name Internal Marks External Marks Total Result', 'MMC201 ANOTHER COURSE']);
  const output = await extractor.extract('card.pdf', 'original');
  assert.equal(output.extraction.extractionMethod,'pdfjs-text');
  assert.equal(output.extraction.subjects.length,2);
  assert.equal(extractor.hasCompleteTextRows(output.extraction),false);
  assert.equal(state.aiCalls, 0);
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC101']), null);
});

test('malformed PDF text identity uses an exact local visual rereading without changing the supplied student identity', async () => {
  const badIdentity = identity.map(line => line.replace('1MV25MC061', '1IMV25MC061'));
  const { extractor, state, aiResult } = fixture([...badIdentity, ...rows]);
  const initial = await extractor.extract('card.pdf', 'original');
  assert.equal(initial.extraction.extractionMethod,'pdfjs-text');
  assert.equal(initial.extraction.student.usn,'1IMV25MC061');
  assert.equal(extractor.hasCompleteTextRows(initial.extraction),false);
  const student = { usn: '1MV25MC061', name: 'TEST STUDENT' }, before = JSON.stringify(student);
  const evidence = await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student);
  assert.equal(evidence.student.usn, student.usn);
  assert.equal(evidence.student.nativeUsn, '1IMV25MC061');
  assert.equal(evidence.student.identitySource, 'local-ocr');
  assert.equal(JSON.stringify(student), before);
  assert.equal(state.pageCalls, 1); assert.equal(state.ocrCalls, 1);
});

test('a different valid PDF USN is never replaced by OCR or the selected student', async () => {
  const { extractor, state } = fixture();
  const evidence = await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], { usn: '1MV25MC062', name: 'TEST STUDENT' });
  assert.equal(evidence.student.usn, '1MV25MC061');
  assert.equal(state.pageCalls, 0); assert.equal(state.ocrCalls, 0);
});

test('visual identity verification permits existing same-length I/1 OCR normalization, never extra-character truncation', async () => {
  const badIdentity = identity.map(line => line.replace('1MV25MC061', '1IMV25MC061'));
  for (const [visible, accepted] of [['IMV25MC061', true], ['1MV25MC0061', false], ['1MV25MC062', false]]) {
    const { extractor, state } = fixture([...badIdentity, ...rows]);
    state.ocrText = identity.join('\n').replace('1MV25MC061', visible);
    const evidence = await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], { usn: '1MV25MC061', name: 'TEST STUDENT' });
    assert.equal(Boolean(evidence), accepted);
    if (accepted) { assert.equal(evidence.student.usn, '1MV25MC061'); assert.equal(evidence.student.visibleUsn, visible); }
  }
});

test('successful evidence is cached by document contents and identity, with independent returned objects', async () => {
  const { extractor, state } = fixture();
  const student = { usn: '1MV25MC061', name: 'TEST STUDENT' };
  // This isolated module uses synthetic file contents; no uploaded file is read.
  const module = { exports: {} }; let contents = Buffer.from('first synthetic PDF');
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/documentExtractor.js'), 'utf8'), {
    module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, process: { env: {} },
    require(name) {
      if (name === 'fs') return { existsSync: () => true, readFileSync: () => contents };
      if (name === './aiProviders') return { isConfigured: () => false };
      if (name === './pdfAdmission') return pdfAdmission;
      return require(name);
    }
  });
  const cached = module.exports;
  cached.extractPdfTextWithCoordinates = extractor.extractPdfTextWithCoordinates;
  const first = await cached.readOriginalResultEvidence('card.pdf', ['MMC101'], student);
  first.subjects[0].result = 'F';
  const second = await cached.readOriginalResultEvidence('card.pdf', ['MMC101'], student);
  assert.equal(second.subjects[0].result, 'P');
  assert.equal(state.pdfCalls, 1);
  contents = Buffer.from('different synthetic PDF');
  await cached.readOriginalResultEvidence('card.pdf', ['MMC101'], student);
  assert.equal(state.pdfCalls, 2);
  await cached.readOriginalResultEvidence('card.pdf', ['MMC102'], student);
  assert.equal(state.pdfCalls, 3);
});

test('malformed text identity recovery rejects missing or conflicting visual USN/name evidence', async () => {
  const badIdentity = identity.map(line => line.replace('1MV25MC061', '1IMV25MC061'));
  for (const ocrText of ['', identity.join('\n').replace('1MV25MC061', '1MV25MC062'),
    identity.join('\n').replace('TEST STUDENT', 'OTHER STUDENT')]) {
    const { extractor, state } = fixture([...badIdentity, ...rows]);
    state.ocrText = ocrText;
    assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], { usn: '1MV25MC061', name: 'TEST STUDENT' }), null);
  }
});

test('image-only PDFs skip visual identity OCR and cache the unavailable native table', async () => {
  const { extractor, state } = fixture([], true);
  const student = { usn: '1MV25MC061', name: 'TEST STUDENT' };
  for (let i = 0; i < 3; i++) assert.equal(await extractor.readOriginalResultEvidence('scan.pdf', ['MMC101'], student), null);
  assert.equal(state.pdfCalls, 1);
  assert.equal(state.pageCalls, 0);
  assert.equal(state.ocrCalls, 0);
  assert.equal(state.aiCalls, 0);
});

test('incomplete native tables do not trigger visual identity OCR', async () => {
  const badIdentity = identity.map(line => line.replace('1MV25MC061', '1IMV25MC061'));
  const { extractor, state } = fixture([...badIdentity, 'MMC101 COURSE 40 40 79 P'], true);
  const student = { usn: '1MV25MC061', name: 'TEST STUDENT' };
  assert.equal(await extractor.readOriginalResultEvidence('incomplete.pdf', ['MMC101'], student), null);
  assert.equal(await extractor.readOriginalResultEvidence('incomplete.pdf', ['MMC101'], student), null);
  assert.equal(state.pdfCalls, 1);
  assert.equal(state.ocrCalls, 0);
});

test('cached native-table misses are invalidated by document, scope and identity changes', async () => {
  const { extractor, state } = fixture([], true);
  const student = { usn: '1MV25MC061', name: 'TEST STUDENT' };
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student), null);
  state.contents = Buffer.from('replacement synthetic PDF');
  state.pdfLines = [...identity, ...rows];
  assert.ok(await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student));
  assert.equal(state.pdfCalls, 2);
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC999'], student), null);
  assert.equal(state.pdfCalls, 3);
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC999'], { ...student, usn: '1MV25MC062' }), null);
  assert.equal(state.pdfCalls, 4);
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC999'], { ...student, name: 'ANOTHER STUDENT' }), null);
  assert.equal(state.pdfCalls, 5);
});

test('native read and visual OCR failures remain retryable rather than cached', async () => {
  const badIdentity = identity.map(line => line.replace('1MV25MC061', '1IMV25MC061'));
  const { extractor, state } = fixture([...badIdentity, ...rows], true);
  const student = { usn: '1MV25MC061', name: 'TEST STUDENT' };
  state.pdfThrows = true;
  await assert.rejects(extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student), /No readable PDF text/);
  state.pdfThrows = false;
  const ocr = extractor.ocrImage;
  extractor.ocrImage = async () => { throw new Error('OCR temporarily unavailable'); };
  await assert.rejects(extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student), /temporarily unavailable/);
  extractor.ocrImage = ocr;
  const evidence = await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student);
  assert.equal(evidence.student.identitySource, 'local-ocr');
  assert.equal(state.pdfCalls, 3);
  assert.ok(await extractor.readOriginalResultEvidence('card.pdf', ['MMC101'], student));
  assert.equal(state.pdfCalls, 3);
});

test('a file replaced during the native check cannot populate the miss cache', async () => {
  const { extractor, state } = fixture([], true);
  const contents = state.contents;
  const read = extractor.extractPdfTextWithCoordinates;
  extractor.extractPdfTextWithCoordinates = async (...args) => {
    const result = await read(...args);
    state.contents = Buffer.from('changed during read');
    return result;
  };
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf'), null);
  state.contents = contents;
  extractor.extractPdfTextWithCoordinates = read;
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf'), null);
  assert.equal(state.pdfCalls, 2);
});

test('complete native revaluation rows preserve all nine independent card fields',async()=>{
  const {extractor,state}=fixture([...identity,'MMC101 PROGRAMMING 40 10 F 30 P 30 P']);
  const output=await extractor.extract('revaluation.pdf','revaluation');
  const row=output.extraction.subjects[0];
  assert.equal(output.extraction.extractionMethod,'pdfjs-text');
  for(const [key,value] of Object.entries({internalMarks:40,oldMarks:10,oldResult:'F',rvMarks:30,rvResult:'P',finalMarks:30,finalResult:'P'}))assert.equal(row[key],value,key);
  assert.equal(state.aiCalls,0);
});

for(const [name,lines,expected] of [
  ['missing marks',[...identity,'MMC101 COURSE 40 40 80 P','MMCL106 LABORATORY 97 P'],[]],
  ['inconsistent printed total',[...identity,'MMC101 COURSE 40 40 79 P'],[]],
  ['two numbers without printed total',[...identity,'MMC101 COURSE 40 40 P'],[]],
  ['no explicit result status',[...identity,'MMC101 COURSE 40 40 80'],[]],
  ['result letter only in subject name',[...identity,'MMC101 P COURSE 40 40 80'],[]],
  ['subject-name letter contradicts actual printed result',[...identity,'MMC101 P COURSE 40 40 80 F'],[]],
  ['configured subject missing',[...identity,'MMC101 COURSE 40 40 80 P'],['MMC101','MMCL106']],
  ['duplicate subject code',[...identity,'MMC101 COURSE 40 40 80 P','MMC101 COURSE 45 45 90 P'],[]],
  ['ambiguous numbers in course name',[...identity,'MMC101 PYTHON 3 40 40 80 P'],[]]
]){
  test(name+' remains readable text while strict completeness still fails',async()=>{
    const {extractor,state,aiResult}=fixture(lines);
    const output=await extractor.extract('partial.pdf','original',{expectedSubjectCodes:expected});
    assert.equal(output.extraction.extractionMethod,'pdfjs-text');
    assert.equal(extractor.hasCompleteTextRows(output.extraction,expected),false);
    assert.equal(state.aiCalls,0);assert.equal(state.sparseCalls,0);
  });
}

test('imperfect readable PDF never calls unavailable AI and preserves absent lab components',async()=>{
  const {extractor,state}=fixture([...identity,'MMC101 COURSE 40 40 80 P','MMCL106 LABORATORY 97 P']);
  state.aiThrows=true;
  const output=await extractor.extract('partial.pdf','original');
  const lab=output.extraction.subjects.find(row=>row.subjectCode==='MMCL106');
  assert.equal(lab.internalMarks,null);assert.equal(lab.externalMarks,null);
  assert.equal(extractor.hasCompleteTextRows(output.extraction),false);
  assert.equal(state.pdfCalls,1);assert.equal(state.aiCalls,0);assert.equal(state.sparseCalls,0);
});

test('partial retake cards can use native text without requiring unattempted session subjects',async()=>{
  const {extractor,state}=fixture([...identity,'MMCL106 LABORATORY 48 49 97 P']);
  const output=await extractor.extract('retake.pdf','original',{expectedSubjectCodes:[]});
  assert.equal(output.extraction.subjects.length,1);assert.equal(state.aiCalls,0);
});

test('PDF text parsing failure still allows the AI path',async()=>{
  const {extractor,state,aiResult}=fixture();state.pdfThrows=true;
  assert.equal(await extractor.extract('scan.pdf'),aiResult);assert.equal(state.aiCalls,1);
});

for(const type of ['original','revaluation']){
  test(type+' image extraction retains its existing local OCR path',async()=>{
    const {extractor,state}=fixture();state.configured=false;
    await extractor.extract('image.png',type);
    assert.equal(state.pdfCalls,0);assert.equal(state.ocrCalls,1);assert.equal(state.aiCalls,0);
  });
}

test('native PDF path remains available when AI is disabled',async()=>{
  const {extractor,state}=fixture();state.configured=false;state.mode='tesseract';
  assert.equal((await extractor.extract('card.pdf')).extraction.subjects.length,6);
  assert.equal(state.aiCalls,0);
});

test('PDF pages at the same vertical coordinate never combine marks into another page row',()=>{
  const {extractor}=fixture();
  const words=[
    {text:'MMC101 COURSE 40 40 80 P',x:10,y:100,page:1},
    {text:'MMCL106 LABORATORY 48 49 97 P',x:10,y:100,page:2}
  ];
  const grouped=extractor.groupItemsIntoLines(words,'');
  assert.equal(grouped.length,2);
  const parsed=extractor.parseProductionData(identity.join('\n'),words,'original');
  assert.equal(parsed.subjects.length,2);
  assert.equal(parsed.subjects[0].totalMarks,80);assert.equal(parsed.subjects[1].totalMarks,97);
});

