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
function fixture(lines = [...identity,...rows]) {
  const state = { aiCalls:0, pdfCalls:0, ocrCalls:0, configured:true, mode:'auto', aiThrows:false, pdfThrows:false };
  const module = {exports:{}};
  const aiResult = { success:true, extraction:{extractionMethod:'test-ai',subjects:[]} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/documentExtractor.js'),'utf8'), {
    module, exports:module.exports, console:{log(){},warn(){},error(){}},
    process:{env:{get EXTRACTION_MODE(){return state.mode;}}},
    require(name) {
      if(name==='fs')return {existsSync:()=>true};
      if(name==='./aiProviders')return {isConfigured:()=>state.configured};
      if(name==='./vlmExtractor')return {extract:async()=>{state.aiCalls++;if(state.aiThrows)throw new Error('AI unavailable');return aiResult;}};
      return require(name);
    }
  });
  const extractor=module.exports;
  extractor.extractSparseRows=async()=>null;
  extractor.extractPdfTextWithCoordinates=async()=>{
    state.pdfCalls++;
    if(state.pdfThrows)throw new Error('No readable PDF text');
    return {text:lines.join('\n'),words:lines.map((text,i)=>({text,x:0,y:i*30,page:1,height:12}))};
  };
  extractor.ocrImage=async()=>{state.ocrCalls++;return {text:[...identity,...rows].join('\n'),words:[]};};
  return {extractor,state,aiResult};
}

test('complete embedded PDF text retains the wrapped last lab row before AI can omit it',async()=>{
  const {extractor,state}=fixture();
  const output=await extractor.extract('card.pdf','original',{expectedSubjectCodes:['MMC101','MMC102','MMC103','MMC104','MMC105','MMCL106']});
  assert.equal(output.extraction.extractionMethod,'pdfjs-text');
  assert.equal(output.extraction.subjects.length,6);
  const last=output.extraction.subjects.find(row=>row.subjectCode==='MMCL106');
  assert.equal(last.internalMarks,48);assert.equal(last.externalMarks,49);assert.equal(last.totalMarks,97);
  assert.equal(state.aiCalls,0);assert.equal(state.ocrCalls,0);assert.equal(state.pdfCalls,1);
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

