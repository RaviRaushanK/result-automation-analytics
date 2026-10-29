'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');


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
const identity = ['University Seat Number : 1MV25MC061','Student Name : TEST STUDENT','Semester : 1'];
const rows = [
  'MMC101 PROGRAMMING AND 50 36 86 P 2026-04-28', 'PROBLEM SOLVING IN C',
  'MMC102 DISCRETE MATHEMATICS 47 32 79 P 2026-04-28', 'AND GRAPH THEORY',
  'MMC103 DATABASE 48 25 73 P 2026-04-28', 'MANAGEMENT SYSTEMS (DBMS)',
  'MMC104 OPERATING SYSTEM 43 30 73 P 2026-04-28',
  'MMC105 WEB TECHNOLOGIES 49 35 84 P 2026-04-28',
  'MMCL106 DBMS AND WEB 48 49 97 P 2026-04-28', 'TECHNOLOGIES', 'LABORATORY'
];
function fixture(lines = [...identity,...rows], cacheContents = false) {
  const state = { aiCalls:0, pdfCalls:0, ocrCalls:0, pageCalls:0, configured:true, mode:'auto', aiThrows:false, pdfThrows:false,
    pdfLines: lines, contents: Buffer.from('synthetic PDF contents') };
  const module = {exports:{}};
  const aiResult = { success:true, extraction:{extractionMethod:'test-ai',subjects:[]} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/documentExtractor.js'),'utf8'), {
    module, exports:module.exports, console:{log(){},warn(){},error(){}},
    process:{env:{get EXTRACTION_MODE(){return state.mode;}}},
    require(name) {
      if(name==='fs')return {existsSync:()=>true, ...(cacheContents ? { readFileSync:()=>state.contents } : {})};
      if(name==='./aiProviders')return {isConfigured:()=>state.configured};
      if(name==='./pageRenderer')return {renderPdfToImages:async()=>{state.pageCalls++;return [{buffer:Buffer.from('rendered page')}];}};
      if(name==='./vlmExtractor')return {extract:async()=>{state.aiCalls++;if(state.aiThrows)throw new Error('AI unavailable');return aiResult;}};
      return require(name);
    }
  });
  const extractor=module.exports;
  extractor.extractSparseRows=async()=>null;
  extractor.extractPdfTextWithCoordinates=async()=>{
    state.pdfCalls++;
    if(state.pdfThrows)throw new Error('No readable PDF text');
    return {text:state.pdfLines.join('\n'),words:state.pdfLines.map((text,i)=>({text,x:0,y:i*30,page:1,height:12}))};
  };
  extractor.ocrImage=async()=>{state.ocrCalls++;return {text:state.ocrText ?? [...identity,...rows].join('\n'),words:[]};};
  return {extractor,state,aiResult};
}

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

test('a wrapped date cannot hide an extra number in the marks row', async () => {
  const { extractor, state, aiResult } = fixture([...identity, 'MMC101 COURSE 7 40 40 80 P 2026-04-', '28']);
  assert.equal(await extractor.extract('ambiguous.pdf'), aiResult);
  assert.equal(state.aiCalls, 1);
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

test('table header filtering retains incomplete actual course rows and later mixed-semester tables', async () => {
  const { extractor, state, aiResult } = fixture([...identity,
    'Subject Code Subject Name Internal Marks External Marks Total Result',
    'MMC101 COURSE 40 40 80 P', 'Semester : 2',
    'Subject Code Subject Name Internal Marks External Marks Total Result', 'MMC201 ANOTHER COURSE']);
  const output = await extractor.extract('card.pdf', 'original');
  assert.equal(output, aiResult);
  assert.equal(state.aiCalls, 1);
  assert.equal(await extractor.readOriginalResultEvidence('card.pdf', ['MMC101']), null);
});

test('malformed PDF text identity uses an exact local visual rereading without changing the supplied student identity', async () => {
  const badIdentity = identity.map(line => line.replace('1MV25MC061', '1IMV25MC061'));
  const { extractor, state, aiResult } = fixture([...badIdentity, ...rows]);
  assert.equal(await extractor.extract('card.pdf', 'original'), aiResult);
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
  ['missing student identity',['Semester : 1','MMC101 COURSE 40 40 80 P'],[]],
  ['configured subject missing',[...identity,'MMC101 COURSE 40 40 80 P'],['MMC101','MMCL106']],
  ['duplicate subject code',[...identity,'MMC101 COURSE 40 40 80 P','MMC101 COURSE 45 45 90 P'],[]],
  ['ambiguous numbers in course name',[...identity,'MMC101 PYTHON 3 40 40 80 P'],[]]
]){
  test(name+' does not bypass the AI/OCR fallback',async()=>{
    const {extractor,state,aiResult}=fixture(lines);
    const output=await extractor.extract('partial.pdf','original',{expectedSubjectCodes:expected});
    assert.equal(output,aiResult);assert.equal(state.aiCalls,1);
  });
}

test('AI failure reuses the readable PDF without inventing absent lab components',async()=>{
  const {extractor,state}=fixture([...identity,'MMC101 COURSE 40 40 80 P','MMCL106 LABORATORY 97 P']);
  state.aiThrows=true;
  const output=await extractor.extract('partial.pdf','original');
  const lab=output.extraction.subjects.find(row=>row.subjectCode==='MMCL106');
  assert.equal(lab.internalMarks,null);assert.equal(lab.externalMarks,null);
  assert.equal(extractor.hasCompleteTextRows(output.extraction),false);
  assert.equal(state.pdfCalls,1);assert.equal(state.aiCalls,1);
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

