'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');


test('focused row retry can recover a JPEG code and independent cells without rewriting the first OCR output',async()=>{
  const {extractor,state,primary}=fixture();
  extractor.ocrImage=async()=>({
    text:identity+'\nMMCI105\nWEB TECHNOLOGIES\n30\n15\n20\n20',
    words:tableWords.filter(word=>!['F','P'].includes(word.text)).map((word,i)=>i?word:{...word,text:'MMCI105'})
  });
  let focusedCalls=0;
  extractor.ocrTableRows=async()=>{focusedCalls++;return ['MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P'];};
  const out=await extractor.extract('card.jpeg','revaluation',{candidateSubjectCodes:['MMC105']});
  assert.equal(focusedCalls,1);
  assert.equal(out.extraction.subjects[0].subjectCode,'MMC105');
  assert.equal(out.extraction.subjects[0].oldMarks,15);
  assert.equal(out.extraction.subjects[0].finalMarks,20);
  assert.equal(primary.subjects.length,0);
  assert.match(out.extraction.rawText,/\[focused table rows\]/);
});

test('a failed focused-row retry cannot turn an empty extraction into a server failure',async()=>{
  const {extractor,state,primary}=fixture();state.partial=true;
  extractor.ocrTableRows=async()=>{throw new Error('Focused OCR unavailable');};
  assert.equal((await extractor.extract('card.jpeg','revaluation')).extraction,primary);
});

test('focused row OCR bounds its work, requests only printed row characters and releases its worker',async()=>{
  let calls=0,terminated=false,parameters;
  const crops=[];
  const chain={};
  for(const method of ['rotate','resize','grayscale','normalize','sharpen','png','threshold','extend'])chain[method]=()=>chain;
  chain.extract=bounds=>{crops.push(bounds);return chain;};
  chain.toBuffer=async()=>Buffer.from('image');
  chain.metadata=async()=>({width:2400,height:2400});
  const worker={setParameters:async value=>{parameters=value;},recognize:async()=>{calls++;return {data:{text:'MMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P'}};},terminate:async()=>{terminated=true;}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/documentExtractor.js'),'utf8'),{
    module,exports:module.exports,console,require(name){
      if(name==='sharp')return ()=>chain;
      if(name==='tesseract.js')return {createWorker:async()=>worker};
      if(name==='./aiProviders')return {};
      if(name==='./pdfAdmission')return require('../services/pdfAdmission');
      return require(name);
    }
  });
  const words=Array.from({length:8},(_,index)=>[
    {text:'MMC105',x:100,y:100+index*50,height:20},
    ...['30','15','20','20'].map((text,i)=>({text,x:500+i*100,y:100+index*50,height:20}))
  ]).flat();
  const rows=await module.exports.ocrTableRows(Buffer.from('image'),words);
  assert.equal(rows.length,6);assert.equal(calls,6);assert.equal(terminated,true);
  assert.equal(parameters.tessedit_pageseg_mode,'13');
  assert.ok(parameters.tessedit_char_whitelist.includes('0123456789'));
  for(const bounds of crops){assert.ok(bounds.left>=0 && bounds.top>=0);assert.ok(bounds.left+bounds.width<=2400);assert.ok(bounds.top+bounds.height<=2400);}
});
const identity = 'University Seat Number : 1MV25MC074\nStudent Name : SINDHUKUMAR S\nSemester : 1';
const row = {subjectCode:'MMC105',subjectName:'WEB TECHNOLOGIES',internalMarks:30,oldMarks:15,oldResult:'F',rvMarks:20,rvResult:'P',finalMarks:20,finalResult:'P',marksValidated:true,marksConfidence:'high'};
const tableWords = ['MMC105','WEB','TECHNOLOGIES','30','15','F','20','P','20','P'].map((text,i)=>({text,x:i*70,y:500,width:50,height:20}));
function fixture() {
  const state = { ai:true, sparseCalls:0, normalCalls:0, renderCalls:0, fail:false, usn:'1MV25MC074', partial:false };
  const primary = {student:{usn:'1MV25MC074',name:'SINDHUKUMAR S'},semester:1,subjects:[],warnings:['No subjects extracted.'],extractionMethod:'test-ai'};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/documentExtractor.js'),'utf8'),{
    module,exports:module.exports,process:{env:{}},console:{warn(){},error(){},log(){}},
    require(name){
      if(name==='fs')return {existsSync:()=>true};
      if(name==='./aiProviders')return {isConfigured:()=>state.ai};
      if(name==='./pdfAdmission')return require('../services/pdfAdmission');
      if(name==='./vlmExtractor')return {extract:async()=>({success:true,extraction:primary})};
      if(name==='./pageRenderer')return {renderPdfToImages:async()=>{state.renderCalls++;return [{pageNumber:1,buffer:'page-1'},{pageNumber:2,buffer:'page-2'}];}};
      return require(name);
    }
  });
  const extractor=module.exports;
  extractor.ocrTableRows=async()=>[];
  extractor.extractPdfTextWithCoordinates=async()=>({text:'',words:[],pageCount:2});
  extractor.ocrImage=async(input,options={})=>{
    if(!options.sparse){state.normalCalls++;return {text:identity,words:[]};}
    state.sparseCalls++;
    assert.equal(options.wordCoordinates,true);
    if(state.fail)throw new Error('OCR unavailable');
    const text=identity.replace('1MV25MC074',state.usn);
    const words=state.partial?tableWords.slice(0,4):tableWords;
    return input==='page-1'?{text,words:[]}:{text:text+'\nMMC105\nWEB TECHNOLOGIES\n30\n15\nF\n20\nP\n20\nP',words};
  };
  return {extractor,state,primary};
}

for(const ext of ['png','jpg','jpeg']){
  test(ext+' empty hybrid extraction recovers separated table cells without changing the independent marks',async()=>{
    const {extractor,state}=fixture();
    const out=await extractor.extract('card.'+ext,'revaluation',{candidateSubjectCodes:['MMC105']});
    assert.equal(state.sparseCalls,1);
    assert.equal(out.extraction.extractionMethod,'tesseract-sparse-ocr');
    const actual=out.extraction.subjects[0];
    for(const key of ['subjectCode','internalMarks','oldMarks','oldResult','rvMarks','rvResult','finalMarks','finalResult'])assert.equal(actual[key],row[key],key);
    assert.equal(out.extraction.subjects.length,1);
    assert.equal(out.extraction.student.usn,'1MV25MC074');
    assert.ok(out.extraction.warnings.some(message=>/recovered subject marks/.test(message)));
    assert.equal(out.extraction.stages.recovery.status,'ok');
  });
}

test('a usable existing row is returned without running additional OCR',async()=>{
  const {extractor,state,primary}=fixture();primary.subjects=[{...row}];
  const out=await extractor.extract('card.png','revaluation',{candidateSubjectCodes:['MMC105']});
  assert.equal(out.extraction,primary);assert.equal(state.sparseCalls,0);
});

test('a misread code triggers recovery against the server roster without fuzzy remapping',async()=>{
  const {extractor,state,primary}=fixture();primary.subjects=[{...row,subjectCode:'MMCI105'}];
  const out=await extractor.extract('card.png','revaluation',{candidateSubjectCodes:['MMC105']});
  assert.equal(state.sparseCalls,1);assert.equal(out.extraction.subjects[0].subjectCode,'MMC105');
  assert.equal(primary.subjects[0].subjectCode,'MMCI105');
});

test('genuinely conflicting fallback USN never replaces the original identity or rows',async()=>{
  const {extractor,state,primary}=fixture();state.usn='1MV25MC075';
  const extraction = (await extractor.extract('card.png','revaluation')).extraction;
  assert.equal(extraction.student,primary.student);
  assert.equal(extraction.subjects,primary.subjects);
  assert.match(extraction.integrity_conflicts[0],/conflicting student USNs/);
  assert.equal(primary.subjects.length,0);
});

test('failed or still-incomplete additional OCR preserves the first extraction for manual review',async()=>{
  for(const option of ['fail','partial']){
    const {extractor,state,primary}=fixture();state[option]=true;
    assert.equal((await extractor.extract('card.png','revaluation')).extraction,primary);
    assert.equal(primary.subjects.length,0);
  }
});

test('the local image path retries sparse OCR after normal OCR misses the row',async()=>{
  const {extractor,state}=fixture();state.ai=false;
  const out=await extractor.extract('card.png','revaluation',{candidateSubjectCodes:['MMC105']});
  assert.equal(state.normalCalls,1);assert.equal(state.sparseCalls,1);
  assert.equal(out.extraction.subjects[0].rvMarks,20);
});

test('scanned PDF fallback rasterizes every supplied page and keeps table coordinates separate',async()=>{
  const {extractor,state}=fixture();state.ai=false;
  const out=await extractor.extract('card.pdf','revaluation');
  assert.equal(state.renderCalls,1);assert.equal(state.sparseCalls,2);
  assert.equal(state.normalCalls,0);
  assert.equal(out.extraction.subjects.length,1);
  assert.equal(out.extraction.subjects[0].subjectCode,'MMC105');
});

test('original result rows can use the same coordinate fallback and retain valid zero marks',async()=>{
  const {extractor,state}=fixture();state.ai=false;
  extractor.ocrImage=async(input,options={})=>options.sparse?{
    text:identity+'\nMMC105\nWEB TECHNOLOGIES\n0\n0\n0\nF',
    words:['MMC105','WEB','TECHNOLOGIES','0','0','0','F'].map((text,i)=>({text,x:i*70,y:500,width:50,height:20}))
  }:{text:identity,words:[]};
  const out=await extractor.extract('card.jpg','original',{candidateSubjectCodes:['MMC105']});
  const actual=out.extraction.subjects[0];
  assert.equal(actual.internalMarks,0);assert.equal(actual.externalMarks,0);assert.equal(actual.totalMarks,0);
});

test('Tesseract parameters and nested word output use the installed worker API and terminate reliably',async()=>{
  for(const fails of [false,true]){
    let parameters,output,terminated=false;
    const worker={
      setParameters:async value=>{parameters=value;},
      recognize:async(image,options,value)=>{output=value;if(fails)throw new Error('recognition failed');return {data:{text:'MMC105',blocks:[{paragraphs:[{lines:[{words:[{text:'MMC105',bbox:{x0:1,y0:2,x1:30,y1:15}}]}]}]}]}};},
      terminate:async()=>{terminated=true;}
    };
    const chain={};for(const method of ['rotate','resize','grayscale','normalize','sharpen','png'])chain[method]=()=>chain;
    chain.toBuffer=async()=>Buffer.from('image');
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/documentExtractor.js'),'utf8'),{
      module,exports:module.exports,console,require(name){
        if(name==='sharp')return ()=>chain;
        if(name==='tesseract.js')return {createWorker:async()=>worker};
        if(name==='./aiProviders')return {};
        if(name==='./pdfAdmission')return require('../services/pdfAdmission');
        return require(name);
      }
    });
    if(fails)await assert.rejects(module.exports.ocrImage('image.png',{sparse:true,wordCoordinates:true}),/recognition failed/);
    else{
      const result=await module.exports.ocrImage('image.png',{sparse:true,wordCoordinates:true});
      assert.equal(result.words[0].text,'MMC105');assert.equal(result.words[0].x,1);assert.equal(result.words[0].height,13);
    }
    assert.equal(parameters.tessedit_pageseg_mode,'11');
    assert.equal(output.blocks,true);assert.equal(terminated,true);
  }
});

