'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { createCanvas } = require('@napi-rs/canvas');
const validation = require('../public/js/marks-card-validation');
const { marksCardFilter, verifyMarksCard } = require('../middlewares/marksCardUpload');
const root = path.resolve(__dirname, '..');

async function tempDirectory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sraas-card-'));
  t.after(async () => {
    for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
    await fs.rmdir(dir);
  });
  return dir;
}

test('marks-card policy allows exactly the database and classic OCR image formats', () => {
  assert.deepEqual([...validation.extensions].sort(), ['.jpeg', '.jpg', '.pdf', '.png']);
  for (const [ext, type] of Object.entries(validation.formats)) {
    assert.equal(validation.error({ name: 'CARD' + ext.toUpperCase(), type, size: 200 }), '');
  }
  for (const file of [
    { name: 'card.svg', type: 'image/svg+xml' },
    { name: 'card.webp', type: 'image/webp' },
    { name: 'card.png', type: 'image/jpeg' },
    { name: 'card.jpg.exe', type: 'image/jpeg' },
    { name: 'card.jpg', type: 'image/jpeg', size: 15 * 1024 * 1024 + 1 },
    { name: 'card.png', type: 'image/png', size: 0 }
  ]) assert.ok(validation.error(file), file.name);
  assert.equal(validation.error({ name: 'card.png', type: '' }), '');
  assert.ok(validation.error({ originalname: 'card.png', mimetype: '' }, { requireMime: true }));
});

for (const flow of ['results', 'revaluation']) {
  test(flow + ' multipart route accepts verified images/PDF and rejects spoofed or oversized files before the controller', async t => {
    const dir = await tempDirectory(t);
    const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const received = [];
    const handlers = new Proxy({}, { get: (_, name) => async (req,res) => {
      if (name !== 'processUpload') return res.send('fixture');
      received.push({ name: req.file.originalname, mime: req.file.mimetype, body: req.body });
      await fs.unlink(req.file.path);
      return res.json({ extracted: true });
    } });
    const module = { exports: {} };
    const upload = options => multer({ ...options, dest: dir });
    vm.runInNewContext(syncFs.readFileSync(path.join(root, 'routes', flow === 'results' ? 'resultRoutes.js' : 'revaluationRoutes.js'), 'utf8'), {
      module, exports: module.exports,
      require(name) {
        if (name === 'multer') return upload;
        if (name.endsWith('Controller')) return handlers;
        if (name === '../middlewares/upload') return { revaluationUpload: multer({ dest: dir, fileFilter: marksCardFilter, limits: { fileSize: 15 * 1024 * 1024 } }) };
        return require(name);
      }
    });
    const app = express();
    app.use('/' + flow, module.exports);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + '/' + flow + (flow === 'results' ? '/upload' : '/7/upload');
    async function post(name, mime, bytes) {
      const body = new FormData();
      body.set('sessionId', '20');
      body.set(flow === 'results' ? 'resultDocument' : 'revalidationDocument', new Blob([bytes], { type: mime }), name);
      return fetch(url, { method: 'POST', body, redirect: 'manual' });
    }
    for (const [name, mime, bytes] of [
      ['card.png', 'image/png', png], ['card.jpg', 'image/jpeg', jpeg],
      ['CARD.JPEG', 'image/jpeg', jpeg], ['card.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nfixture\n')]
    ]) {
      const response = await post(name,mime,bytes);
      assert.equal(response.status,200,name);
      assert.equal((await response.json()).extracted,true);
      assert.equal(received.at(-1).body.sessionId,'20');
    }
    for (const [name,mime,bytes] of [
      ['card.png','image/jpeg',jpeg],
      ['card.jpg','image/jpeg',Buffer.from('<script>not an image</script>')],
      ['card.png','image/png',jpeg],
      ['card.pdf','application/pdf',png],
      ['card.svg','image/svg+xml',Buffer.from('<svg/>')],
      ['large.png','image/png',Buffer.alloc(15 * 1024 * 1024 + 1)]
    ]) {
      const response = await post(name,mime,bytes);
      assert.equal(response.status,302,name);
      const location = new URL(response.headers.get('location'),url);
      assert.equal(location.pathname,new URL(url).pathname);
      assert.ok(location.searchParams.get('error'));
      assert.equal(received.length,4,'invalid files never reach extraction');
      assert.deepEqual(await fs.readdir(dir),[],'temporary upload is removed');
    }
  });
}

test('image decoding rejects damaged image contents and oversized dimensions', async t => {
  const dir = await tempDirectory(t);
  const file = { path: path.join(dir,'card.png'), originalname:'card.png', mimetype:'image/png' };
  await fs.writeFile(file.path,Buffer.from('not an image'));
  await assert.rejects(verifyMarksCard(file),/image is damaged/);
  const tooLarge = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: '#fff' } }).png().toBuffer();
  await fs.writeFile(file.path,tooLarge);
  await assert.rejects(verifyMarksCard(file),/40 megapixels/);
});

test('real local OCR reads a PNG result card and a JPEG revaluation card without AI or database writes', async t => {
  const dir = await tempDirectory(t);
  const extractor = require('../services/documentExtractor');
  const adapter = require('../services/revaluationExtractor');
  const previousMode = process.env.EXTRACTION_MODE;
  process.env.EXTRACTION_MODE = 'tesseract';
  t.after(() => {
    if (previousMode === undefined) delete process.env.EXTRACTION_MODE;
    else process.env.EXTRACTION_MODE = previousMode;
  });
  function card(lines) {
    const canvas = createCanvas(1800,900);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0,0,1800,900);
    context.fillStyle = '#000'; context.font = '38px Arial';
    lines.forEach((line,index) => context.fillText(line,70,100+index*95));
    return canvas.toBuffer('image/png');
  }
  const identity = ['University Seat Number : 1MV25MC001','Student Name : TEST STUDENT','Semester : 1'];
  const originalPath = path.join(dir,'original.png');
  await fs.writeFile(originalPath,card([...identity,'Subject Code Subject Name Internal External Total Result','MMC101 PROGRAMMING 40 40 80 P']));
  const original = await extractor.extract(originalPath,'original');
  assert.equal(original.extraction.extractionMethod,'tesseract-ocr');
  assert.equal(original.extraction.student.usnNormalized,'1MV25MC001');
  assert.ok(original.extraction.subjects.some(row=>row.subjectCode==='MMC101' && row.internalMarks===40 && row.externalMarks===40));
  const revaluationPath = path.join(dir,'revaluation.jpeg');
  await sharp(card([...identity,'Subject Code Subject Name Internal Old Result RV Result Final Result','MMC101   PROGRAMMING     40     10     F     30     P     30     P'])).jpeg({quality:95}).toFile(revaluationPath);
  const revaluation = await adapter.extractAndBuild(revaluationPath,{
    studentUsn:'1MV25MC001', studentName:'TEST STUDENT',
    allSubjectResults:[{subject_result_id:1,subject_code:'MMC101',subject_name:'PROGRAMMING',marks:50,result_status:'fail',grade:'F',credits:4}]
  });
  assert.equal(revaluation.ok,true);
  assert.equal(revaluation.ocr.extraction_method,'tesseract-ocr');
  assert.ok(revaluation.ocr.subjects.some(row=>row.subject_result_id===1 && row.revised_internal_marks===40 && row.revised_external_marks===30),JSON.stringify({raw:revaluation.ocr.raw_text,subjects:revaluation.ocr.subjects}));
});

