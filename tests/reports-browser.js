'use strict';

// Optional browser verification using installed Edge and native Node WebSocket.
// The loopback harness supplies test sessions; the production app is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const layouts = require('express-ejs-layouts');
const service = require('../services/reportsService');
const { sequelize } = require('../database/models');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(layouts);
  app.set('layout', 'layouts/main');
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const settingsSession = { adminId: 1, username: 'Settings Verification', role: 'admin', csrfToken: 'a'.repeat(64), save: callback => callback() };
  app.use((req, res, next) => {
    req.session = req.path.startsWith('/settings') || ['/profile', '/account-security'].includes(req.path) ? settingsSession : { adminId: 1, username: 'Report verification', role: req.path.startsWith('/subjects') || req.path.startsWith('/faculty') ? 'admin' : 'faculty' };
    res.locals.flash = []; res.locals.breadcrumbItems = [];
    next();
  });
  app.use(require('../middlewares/userMiddleware'));
  app.use(require('../middlewares/themeMiddleware'));
  app.use(require('../middlewares/menuMiddleware'));
  const editBatchFixture = { batch_id: 9001, batch_name: 'MCA 2025', start_year: 2025, end_year: 2027 };
  const editSessionFixture = { session_id: 9100, batch_id: 9001, semester: '1', exam_session: 'Jan', exam_year: 2000, Batch: editBatchFixture };
  const editSubjectFixture = { subject_id: 9200, session_id: 9100, course_id: 9300, subject_code: 'VERIFY', subject_name: 'Verification Project', subject_type: 'project', credits: 0, max_internal: 0, max_external: 100, max_marks: 100 };
  const verificationWrites = [];
  const assignmentFaculty = [1, 2, 3, 4].map(faculty_id => ({ faculty_id, faculty_name: 'Test Faculty ' + faculty_id, status: 'active' }));
  const assignmentSubjects = [{ ...editSubjectFixture, Faculties: [assignmentFaculty[0]] }, { ...editSubjectFixture, subject_id: 9201, subject_code: 'OTHER', subject_name: 'Unassigned Subject', Faculties: [] }];
  app.use((req, res, next) => {
    if (!/\/verification\/(sessions|subjects|faculty)/.test(req.get('referer') || '')) return next();
    if ((req.get('referer') || '').includes('/verification/faculty')) {
      if (req.method === 'GET' && req.path === '/faculty/api') return res.json({ data: assignmentFaculty });
      if (req.method === 'GET' && req.path === '/subjects/session/9100') return res.json(assignmentSubjects);
      if (req.method === 'PUT' && req.path === '/faculty/api/assignments') {
        verificationWrites.push({ path: req.path, body: req.body });
        req.body.assignments.forEach(row => { assignmentSubjects.find(s => s.subject_id === row.subject_id).Faculties = row.faculty_ids.map(id => assignmentFaculty.find(f => String(f.faculty_id) === String(id))); });
        return res.json({ success: true });
      }
      if (req.method === 'DELETE' && req.path === '/faculty/api/assignments/9200/faculty/3') {
        assignmentSubjects[0].Faculties = assignmentSubjects[0].Faculties.filter(f => f.faculty_id !== 3);
        return res.json({ success: true });
      }
    }
    if (req.method === 'GET' && req.path === '/batches') return res.json({ success: true, data: [editBatchFixture] });
    if (req.method === 'GET' && req.path === '/sessions') return res.json({ success: true, data: [editSessionFixture] });
    if (req.method === 'GET' && req.path === '/subjects/session/9100') return res.json([editSubjectFixture]);
    if (req.method === 'PUT' && ['/sessions/9100', '/subjects/9200'].includes(req.path)) {
      verificationWrites.push({ path: req.path, body: req.body });
      const data = Object.assign(req.path.startsWith('/sessions') ? editSessionFixture : editSubjectFixture, req.body);
      return res.json({ success: true, data });
    }
    return next();
  });
  app.use('/reports', require('../routes/reportsRoutes'));
  app.use('/analytics', require('../routes/analyticsRoutes'));
  app.use('/subjects', require('../routes/subjectRoutes'));
  app.use('/students', require('../routes/studentRoutes'));
  app.use('/batches', require('../routes/batchRoutes'));
  app.use('/sessions', require('../routes/sessionRoutes'));
  app.use('/faculty', require('../routes/facultyRoutes'));
  app.use('/results', require('../routes/resultRoutes'));
  app.get('/verification/sessions', (req, res) => res.render('sessions/index', {
    title: 'Session defaults verification', pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/sessions.css'], sessions: [editSessionFixture],
    batches: [{ batch_id: 9003, batch_name: 'Old Batch', start_year: 2020, end_year: 2022 }, { batch_id: 9001, batch_name: 'MCA Test', start_year: 2025, end_year: 2027 }, { batch_id: 9002, batch_name: 'BTech Test', start_year: 2026, end_year: 2030 }]
  }));
  app.get('/verification/subjects', (req, res) => res.render('subjects/index', { title: 'Subject edit verification', pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/subjects.css'] }));
  app.get('/verification/faculty', (req, res) => res.render('faculty/index', { title: 'Faculty count verification', pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/faculty.css'] }));
  app.use('/settings', require('../routes/settingsRoutes'));
  app.use(require('../routes/authRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'sraas-reports-browser-'));
  const browserPath = process.env.REPORTS_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${output}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let browserError;
  browser.on('error', err => { browserError = err; });
  let socket;
  let restoreSettings;
  const testLogoPaths = [];
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      if (browserError) throw browserError;
      try { port = Number((await fs.readFile(path.join(output, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
      catch { await pause(100); }
    }
    if (!port) throw new Error('Edge debugging port was not available.');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const waiting = new Map();
    const exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      if (message.id && waiting.has(message.id)) {
        const { resolve, reject, timer } = waiting.get(message.id);
        clearTimeout(timer); waiting.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      }
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 20000);
      waiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async expression => {
      for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(100); }
      throw new Error(`Browser condition did not complete: ${expression}`);
    };
    const choose = async (name, value) => evaluate(`(() => { const s=document.getElementById(${JSON.stringify('report-' + name)}); s.value=${JSON.stringify(String(value))}; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    const available = name => until(`!document.getElementById(${JSON.stringify('report-' + name)}).disabled`);
    await command('Page.enable'); await command('Runtime.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await command('Page.navigate', { url: `${base}/batches` });
    await until("!!document.getElementById('createBatchHeaderBtn') && document.readyState === 'complete'");
    await evaluate("document.getElementById('createBatchHeaderBtn').click()");
    await until("document.getElementById('createBatchModal').classList.contains('show')");
    await pause(400);
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}');document.getElementById('createBatchStartYear').value='2025';document.querySelector('#createBatchStartYearPicker').hidden=true;document.querySelector('[aria-controls=createBatchStartYearPicker]').setAttribute('aria-expanded','false');document.querySelector('[aria-controls=createBatchStartYearPicker]').click()`);
      await pause(200);
      assert.equal(await evaluate("document.getElementById('createBatchStartYearPicker').hidden"), false);
      assert.equal(await evaluate("document.querySelector('#createBatchStartYearPicker [data-pick-year=\"2025\"]').getAttribute('aria-pressed')"), 'true');
      assert.equal(await evaluate("document.getElementById('createBatchModal').scrollWidth <= innerWidth + 1"), true);
      assert.equal(await evaluate("[...document.querySelectorAll('#createBatchStartYearPicker [data-pick-year]')].every(button=>button.scrollWidth<=button.clientWidth+1)"), true);
      await fs.writeFile(path.join(output, `batch-create-year-picker-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await evaluate("document.querySelector('#createBatchStartYearPicker [data-pick-year=\"2025\"]').click()");
      assert.equal(await evaluate("document.getElementById('createBatchStartYear').value"), '2025');
      assert.equal(await evaluate("document.getElementById('createBatchStartYearPicker').hidden"), true);
    }
    await evaluate("document.getElementById('createBatchEndYear').value='2025';document.querySelector('[aria-controls=createBatchEndYearPicker]').click();document.querySelector('#createBatchEndYearPicker [data-pick-year=\"2027\"]').click()");
    assert.equal(await evaluate("document.getElementById('createBatchEndYear').value"), '2027');
    await evaluate("document.getElementById('createBatchEndYear').value='2024';document.getElementById('createBatchEndYear').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createBatchSubmitBtn').click()");
    assert.equal(await evaluate("document.getElementById('createBatchEndYear').classList.contains('is-invalid')"), true);
    assert.equal(await evaluate("document.getElementById('createBatchEndYearError').textContent.includes('greater than start year')"), true);
    assert.equal(await evaluate("document.getElementById('createBatchDepartment').tagName === 'SELECT' && /master of computer applications/i.test(document.getElementById('createBatchDepartment').selectedOptions[0].textContent)"), true);
    assert.equal(await evaluate("document.getElementById('createBatchCourseName').placeholder"), 'MCA');
    await evaluate("document.getElementById('createBatchCourseName').value='MCA';document.getElementById('createBatchYear').value='2024';document.querySelector('[aria-controls=createBatchYearPicker]').click();document.querySelector('#createBatchYearPicker [data-pick-year=\"2025\"]').click();document.getElementById('createBatchEndYear').value='2027';document.getElementById('createBatchEndYear').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createBatchSubmitBtn').click()");
    await until("document.getElementById('confirmCreateModal').classList.contains('show')");
    assert.equal(await evaluate("document.querySelector('#confirmCreateModal [data-field=start_year]').textContent"), '2025');
    assert.equal(await evaluate("document.querySelector('#confirmCreateModal [data-field=end_year]').textContent"), '2027');
    assert.equal(await evaluate("document.querySelector('#confirmCreateModal [data-field=batch_name]').textContent"), 'MCA 2025');
    console.log('Create Batch: year selection, manual entry, validation, confirmation and mobile/light/dark layout passed (no batch saved)');
    await command('Page.navigate', { url: `${base}/batches` });
    await until("document.querySelector('#batchesTableBody [data-action=edit]') && document.readyState === 'complete'");
    await evaluate("document.querySelector('#batchesTableBody [data-action=edit]').click()");
    await until("document.getElementById('editBatchModal').classList.contains('show')");
    await pause(400);
    assert.equal(await evaluate("!!document.getElementById('editBatchCourseName').value && !!document.getElementById('editBatchYear').value && !document.getElementById('editBatchName')"), true);
    for (const [id, year] of [['editBatchStartYear', '2025'], ['editBatchEndYear', '2027']]) {
      await evaluate(`document.getElementById('${id}').value='2025';document.querySelector('[aria-controls=${id}Picker]').click();document.querySelector('#${id}Picker [data-pick-year="${year}"]').click()`);
      assert.equal(await evaluate(`document.getElementById('${id}').value`), year);
    }
    await evaluate("document.getElementById('editBatchCourseName').value='MCA';document.getElementById('editBatchYear').value='2025';document.getElementById('editBatchSubmitBtn').click()");
    await until("document.getElementById('confirmEditModal').classList.contains('show')");
    assert.equal(await evaluate("document.querySelector('#confirmEditModal [data-field=batch_name]').textContent"), 'MCA 2025');
    await command('Page.navigate', { url: `${base}/verification/sessions` });
    await until("document.readyState === 'complete' && !!document.getElementById('createSessionHeaderBtn')");
    await evaluate("document.getElementById('createSessionHeaderBtn').click()");
    await until("document.getElementById('createSessionModal').classList.contains('show')");
    await pause(400);
    assert.equal(await evaluate("document.getElementById('createSessionBatch').value"), '9002');
    assert.equal(await evaluate("document.getElementById('createSessionSemester').options.length - 1"), 8);
    await evaluate("document.getElementById('createSessionBatch').value='9001';document.getElementById('createSessionBatch').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('createSessionSemester').options.length - 1"), 4);
    assert.equal(await evaluate("document.querySelector('label[for=createSessionMonth]').textContent.includes('Starting')"), false);
    assert.equal(await evaluate("document.getElementById('createSessionStatus').value"), '');
    await until("document.getElementById('currentSessionName').textContent === 'Semester 1'");
    assert.equal(await evaluate("document.getElementById('currentSessionLabel').textContent"), 'Latest Session');
    await evaluate("document.getElementById('createSessionMonth').value='Jan';document.getElementById('createSessionYear').value='2000';document.getElementById('createSessionYear').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('createSessionStatus').value"), 'Completed');
    await evaluate("document.getElementById('createSessionYear').value='2200';document.getElementById('createSessionYear').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('createSessionStatus').value"), 'Upcoming');
    await evaluate("document.getElementById('createSessionYear').value='2026';document.querySelector('[aria-controls=createSessionYearPicker]').click();document.querySelector('#createSessionYearPicker [data-pick-year=\"2025\"]').click()");
    assert.equal(await evaluate("document.getElementById('createSessionYear').value"), '2025');
    await evaluate("document.getElementById('createSessionMonth').value=new Date().toLocaleString('en-US',{month:'short'});document.getElementById('createSessionYear').value=new Date().getFullYear();document.getElementById('createSessionYear').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('createSessionStatus').value"), 'Active');
    await evaluate("document.getElementById('createSessionSubmitBtn').click()");
    assert.equal(await evaluate("document.getElementById('createSessionSemester').classList.contains('is-invalid')"), true);
    assert.equal(await evaluate("document.getElementById('confirmCreateSessionModal').classList.contains('show')"), false);
    await evaluate("document.getElementById('createSessionSemester').value='1';document.getElementById('createSessionSemester').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('createSessionMonth').value='Jun';document.getElementById('createSessionYear').value=new Date().getFullYear()-1;document.getElementById('createSessionYear').dispatchEvent(new Event('input',{bubbles:true}))");
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}')`); await pause(150);
      assert.equal(await evaluate("document.getElementById('createSessionModal').scrollWidth <= innerWidth + 1"), true);
      await fs.writeFile(path.join(output, `session-create-defaults-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await evaluate("document.getElementById('createSessionSubmitBtn').click()");
    await until("document.getElementById('confirmCreateSessionModal').classList.contains('show')");
    assert.equal(await evaluate("document.getElementById('confirmCreateSessionSummary').textContent.includes('Completed')"), true);
    await command('Page.navigate', { url: `${base}/verification/sessions` });
    await until("document.querySelector('#sessionsTableBody [data-action=edit]') && document.readyState === 'complete'");
    await evaluate("document.querySelector('#sessionsTableBody [data-action=edit]').click()");
    await until("document.getElementById('editSessionModal').classList.contains('show') && !document.getElementById('editSessionSubmitBtn').disabled");
    await pause(400);
    assert.equal(await evaluate("document.getElementById('editSessionSemester').disabled"), true);
    await evaluate("document.getElementById('editSessionMonth').value='Nov';document.getElementById('editSessionYear').value='2026';document.getElementById('editSessionYear').dispatchEvent(new Event('input',{bubbles:true}))");
    for (const width of [1440, 390]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate("document.querySelector('[aria-controls=editSessionYearPicker]').click()"); await pause(200);
      assert.equal(await evaluate("document.getElementById('editSessionModal').scrollWidth<=innerWidth+1"), true);
      await fs.writeFile(path.join(output, `session-edit-year-picker-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await evaluate("document.querySelector('#editSessionYearPicker [data-pick-year=\"2026\"]').click()");
    }
    await evaluate("document.getElementById('editSessionSubmitBtn').click()");
    await until("document.getElementById('confirmEditSessionModal').classList.contains('show')");
    await pause(400);
    await evaluate("document.getElementById('confirmEditSessionBtn').click()");
    await until("!document.getElementById('confirmEditSessionModal').classList.contains('show')");
    assert.equal(verificationWrites[0].body.semester, '1');
    assert.equal(verificationWrites[0].body.exam_session, 'Nov');
    await command('Page.navigate', { url: `${base}/verification/subjects` });
    await until("document.getElementById('subjectSessionSelect')?.options.length>1 && !document.getElementById('subjectSessionSelect').disabled");
    await evaluate("document.getElementById('subjectSessionSelect').value='9100';document.getElementById('subjectSessionSelect').dispatchEvent(new Event('change',{bubbles:true}))");
    await until("!!document.querySelector('[data-edit-subject=\"9200\"]')");
    await evaluate("document.querySelector('[data-edit-subject=\"9200\"]').click()");
    await until("document.getElementById('subjectFormModal').classList.contains('show')");
    await pause(400);
    assert.equal(await evaluate("document.getElementById('subjectCredits').value"), '0');
    assert.equal(await evaluate("document.getElementById('subjectInternal').value"), '0');
    assert.equal(await evaluate("document.getElementById('subjectType').value"), 'project');
    await evaluate("document.getElementById('subjectName').value='Corrected Project';document.getElementById('subjectSaveBtn').click()");
    await until("document.getElementById('subjectConfirmModal').classList.contains('show')");
    await pause(400);
    assert.equal(await evaluate("document.getElementById('subjectConfirmSummary').textContent.includes('linked examination offerings')"), true);
    await evaluate("document.getElementById('subjectConfirmBtn').click()");
    await until("!document.getElementById('subjectConfirmModal').classList.contains('show')");
    assert.equal(verificationWrites[1].body.subject_name, 'Corrected Project');
    console.log('Edit forms: split batch fields, year pickers, locked semester/month-year update, session summary and zero-credit/project subject confirmation passed (fixture saves only)');
    const batchResponse = await (await fetch(`${base}/batches?format=json`)).json();
    const latestBatch = require('../public/js/academic-form-options').sortBatches(batchResponse.data)[0];
    await command('Page.navigate', { url: `${base}/results/upload` });
    await until("document.readyState==='complete' && !!document.getElementById('uploadBatchSelect')");
    assert.equal(await evaluate("document.getElementById('uploadBatchSelect').value"), String(latestBatch.batch_id));
    assert.equal(await evaluate("[...document.getElementById('resultSessionSelect').options].filter(o=>o.value).every(o=>o.dataset.batchId===document.getElementById('uploadBatchSelect').value)"), true);
    assert.equal(await evaluate("document.getElementById('extractButton').disabled"), true);
    for (const width of [1440, 390]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await pause(200);
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
      await fs.writeFile(path.join(output, `result-upload-batch-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    const uploadSessions = (await (await fetch(`${base}/sessions?format=json`)).json()).data;
    const uploadSession = uploadSessions.find(row => batchResponse.data.some(b => String(b.batch_id) === String(row.batch_id)));
    if (uploadSession) {
      await evaluate(`document.getElementById('uploadBatchSelect').value='${uploadSession.batch_id}';document.getElementById('uploadBatchSelect').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('resultSessionSelect').value='${uploadSession.session_id}';document.getElementById('resultSessionSelect').dispatchEvent(new Event('change',{bubbles:true}))`);
      await until("document.getElementById('sessionDetailsCard').style.display==='block'");
      await evaluate("document.getElementById('uploadBatchSelect').value='';document.getElementById('uploadBatchSelect').dispatchEvent(new Event('change',{bubbles:true}))");
      assert.equal(await evaluate("document.getElementById('resultSessionSelect').disabled && document.getElementById('sessionDetailsCard').style.display==='none' && document.getElementById('extractButton').disabled"), true);
    }
    await command('Page.navigate', { url: `${base}/verification/faculty` });
    await until("document.getElementById('facultySessionSelect')?.options.length>1 && !document.getElementById('facultySessionSelect').disabled");
    await evaluate("document.getElementById('facultySessionSelect').value='9100';document.getElementById('facultySessionSelect').dispatchEvent(new Event('change',{bubbles:true}))");
    await until("!!document.querySelector('[data-edit-faculty=\"9200\"]')");
    await evaluate("document.querySelector('[data-edit-faculty=\"9200\"]').click()");
    assert.equal(await evaluate("document.getElementById('facultyConfirmModal').classList.contains('show')"), false);
    await evaluate("document.querySelector('[data-faculty-count=\"9200\"]').value=3;document.querySelector('[data-faculty-count=\"9200\"]').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await evaluate("document.querySelectorAll('[data-faculty-subject=\"9200\"]').length"), 3);
    await evaluate("[...document.querySelectorAll('[data-faculty-subject=\"9200\"]')].forEach((s,i)=>{s.value=String(i===2?2:i+1);s.dispatchEvent(new Event('change',{bubbles:true}))});document.querySelector('[data-review-faculty=\"9200\"]').click()");
    assert.equal(await evaluate("document.getElementById('facultyConfirmModal').classList.contains('show')"), false);
    await evaluate("document.querySelector('[data-faculty-subject=\"9200\"][data-position=\"2\"]').value='3';document.querySelector('[data-faculty-subject=\"9200\"][data-position=\"2\"]').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('facultySearch').value='VERIFY';document.getElementById('facultySearch').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await evaluate("document.querySelector('[data-faculty-subject=\"9200\"][data-position=\"2\"]').value"), '3');
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}')`); await pause(150);
      await evaluate("window.scrollTo(0,0)");
      await fs.writeFile(path.join(output, `faculty-many-edit-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, JSON.stringify(await evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(e).position!=='fixed').slice(0,15).map(e=>[e.tagName,e.className,e.clientWidth,e.scrollWidth])")));
    }
    await evaluate("document.querySelector('[data-review-faculty=\"9200\"]').click()");
    await until("document.getElementById('facultyConfirmModal').classList.contains('show')"); await pause(400);
    assert.equal(await evaluate("document.getElementById('facultyConfirmSummary').textContent.includes('Test Faculty 3') && !document.getElementById('facultyConfirmSummary').textContent.includes('Unassigned Subject')"), true);
    await evaluate("document.getElementById('facultyConfirmSaveBtn').click()");
    await until("!document.getElementById('facultyConfirmModal').classList.contains('show') && !!document.querySelector('[data-edit-faculty=\"9200\"]')");
    const facultyWrite = verificationWrites.find(row => row.path === '/faculty/api/assignments');
    assert.equal(facultyWrite.body.assignments.length, 1); assert.deepEqual(facultyWrite.body.assignments[0].faculty_ids, ['1','2','3']);
    await evaluate("document.querySelector('[data-edit-faculty=\"9200\"]').click();document.querySelector('[data-faculty-count=\"9200\"]').value=1;document.querySelector('[data-faculty-count=\"9200\"]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-cancel-faculty=\"9200\"]').click()");
    assert.equal(await evaluate("document.querySelector('[data-subject-row=\"9200\"] .faculty-count-value').textContent"), '3');
    await evaluate("document.querySelector('[data-delete-faculty=\"9200\"]').click()");
    await until("document.getElementById('facultyRemoveModal').classList.contains('show')"); await pause(400);
    await evaluate("document.querySelector('[data-remove-faculty=\"3\"]').click();document.getElementById('facultyRemoveBtn').click()");
    await until("!document.getElementById('facultyRemoveModal').classList.contains('show') && document.querySelector('[data-subject-row=\"9200\"] .faculty-count-value')?.textContent==='2'");
    console.log('Faculty count: three-person editing, duplicate validation, search retention, row-only confirmation/save, Cancel and third-faculty removal passed (fixture writes only); Upload Results latest batch default passed');
    for (const [route, select, session] of [['/subjects', 'subjectBatchSelect', 'subjectSessionSelect'], ['/faculty', 'facultyBatchSelect', 'facultySessionSelect']]) {
      await command('Page.navigate', { url: base + route });
      await until(`document.getElementById('${select}')?.value === '${latestBatch.batch_id}' && !document.getElementById('${session}').disabled`);
    }
    await evaluate("document.getElementById('addFacultyBtn').click()");
    await until("document.getElementById('addFacultyModal').classList.contains('show') && !document.getElementById('facultyDepartment').disabled && !!document.getElementById('facultyDepartment').value");
    await pause(400);
    assert.equal(await evaluate("/master of computer applications/i.test(document.getElementById('facultyDepartment').selectedOptions[0].textContent)"), true);
    await evaluate("document.getElementById('facultyCodeInput').value='VERIFY';document.getElementById('facultyNameInput').value='Verification Faculty';document.getElementById('facultyEmailInput').value='bad@@college.edu';document.getElementById('facultyEmailInput').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#addFacultyForm [type=submit]').click()");
    assert.equal(await evaluate("document.getElementById('facultyEmailInput').classList.contains('is-invalid')"), true);
    assert.equal(await evaluate("document.getElementById('facultyConfirmModal').classList.contains('show')"), false);
    await evaluate("document.getElementById('facultyEmailInput').value='teacher@gmail.clh';document.getElementById('facultyEmailInput').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#addFacultyForm [type=submit]').click()");
    assert.equal(await evaluate("document.getElementById('facultyEmailFeedback').textContent.includes('domain ending')"), true);
    assert.equal(await evaluate("document.getElementById('facultyConfirmModal').classList.contains('show')"), false);
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}')`); await pause(150);
      assert.equal(await evaluate("document.getElementById('addFacultyModal').scrollWidth <= innerWidth + 1"), true);
      await fs.writeFile(path.join(output, `faculty-create-email-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await evaluate("document.getElementById('facultyEmailInput').value='teacher@college.edu';document.getElementById('facultyEmailInput').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#addFacultyForm [type=submit]').click()");
    await until("document.getElementById('facultyConfirmModal').classList.contains('show')");
    assert.equal(await evaluate("document.getElementById('facultyConfirmSummary').textContent.includes('teacher@college.edu')"), true);
    console.log('Academic forms: latest batch defaults, 4/8 semester options, consistent automatic session status, MCA department defaults and faculty email validation passed (no saves)');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    const batches = await service.getOptions('batches');
    let scope;
    for (const batch of batches) {
      const semesters = await service.getOptions('semesters', { batch_id: String(batch.batch_id) });
      for (const semester of semesters) {
        const sessions = await service.getOptions('sessions', { batch_id: String(batch.batch_id), semester: semester.semester });
        for (const session of sessions) {
          const query = { batch_id: String(batch.batch_id), semester: semester.semester, session_id: String(session.session_id) };
          const subjects = await service.getOptions('subjects', query);
          const report = await service.getReport('class', query);
          if (subjects.length && report.pagination.totalRows > 0) { scope = { query, subjects, totalRows: report.pagination.totalRows }; break; }
        }
        if (scope) break;
      }
      if (scope) break;
    }
    if (!scope) throw new Error('Browser verification needs a session with subjects and recorded result attempts.');
    const students = await service.getOptions('students', scope.query);
    let selectedStudent;
    for (const student of students) {
      const attempts = await service.getOptions('student-results', { ...scope.query, student_id: String(student.student_id) });
      if (attempts.length) { selectedStudent = { student, attempts }; break; }
    }

    const directory = require('../services/studentDirectoryService');
    const initialStudents = await directory.list({ batch_id: 'all' });
    assert.ok(initialStudents.rows.length > 0, 'Students browser checks need at least one student');
    const identity = initialStudents.rows[0];
    await command('Page.navigate', { url: `${base}/students` });
    await until("!!document.getElementById('filterBatch')");
    assert.equal(await evaluate("document.getElementById('filterBatch').value"), (await directory.list({})).filters.batch_id);
    assert.ok(await evaluate("document.querySelectorAll('.students-results-link').length <= 25"));
    await command('Page.navigate', { url: `${base}/students?batch_id=all` });
    await until("document.getElementById('filterBatch')?.value === 'all' && document.getElementById('statTotal').textContent !== '--'");
    assert.equal(await evaluate("document.querySelectorAll('.students-results-link').length"), initialStudents.rows.length);
    assert.equal(await evaluate("document.getElementById('studentResultCount').textContent.includes('of " + initialStudents.pagination.totalRows + " students')"), true);
    for (const width of [1440, 1280, 768, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}')`); await pause(200);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, `Students ${width} ${theme}`);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('studentPageInfo')).color === getComputedStyle(document.querySelector('.students-page')).color"), true);
      await fs.writeFile(path.join(output, `students-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      if (width === 390) {
        await evaluate("(()=>{document.querySelector('.students-pagination').scrollIntoView({block:'end',behavior:'instant'});const table=document.querySelector('#studentsTable').parentElement;table.scrollLeft=table.scrollWidth})()");
        await pause(150);
        assert.equal(await evaluate("document.querySelector('.students-pagination').getBoundingClientRect().right <= innerWidth"), true);
        assert.equal(await evaluate("document.querySelector('.students-pagination').getBoundingClientRect().bottom <= innerHeight + 1"), true);
        await fs.writeFile(path.join(output, `students-mobile-actions-pagination-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await evaluate("scrollTo({top:0,behavior:'instant'})");
      }
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    if (initialStudents.pagination.totalPages > 1) {
      await evaluate("document.getElementById('studentNextPage').click()");
      await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false' && new URLSearchParams(location.search).get('page') === '2'");
      assert.equal(await evaluate("document.querySelector('#studentsTable tbody td').textContent.trim()"), '26');
      await evaluate("window._studentReloadSentinel = true");
      await command('Page.reload');
      await until("!window._studentReloadSentinel && document.readyState === 'complete' && document.getElementById('studentPageInfo')?.textContent.includes('Page 2') && document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false'");
    }
    for (const search of [identity.usn.toLowerCase(), identity.usn.slice(0, Math.min(identity.usn.length, 8)), identity.student_name, identity.email]) {
      if (!search) continue;
      const expected = await directory.list({ batch_id: 'all', search });
      await evaluate(`document.getElementById('studentSearch').value=${JSON.stringify(search)};document.getElementById('studentSearch').dispatchEvent(new Event('input',{bubbles:true}))`);
      await until(`document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false' && new URLSearchParams(location.search).get('search') === ${JSON.stringify(search)}`);
      assert.equal(await evaluate("document.querySelectorAll('.students-results-link').length"), expected.rows.length);
      assert.equal(await evaluate("new URLSearchParams(location.search).get('page')"), '1');
    }
    await evaluate(`document.getElementById('filterBatch').value='${identity.batch_id}';document.getElementById('filterBatch').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('filterStatus').value='${identity.status}';document.getElementById('filterStatus').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('filterCategory').value=${JSON.stringify(identity.category || '')};document.getElementById('filterCategory').dispatchEvent(new Event('change',{bubbles:true}))`);
    await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false'");
    assert.equal(await evaluate("document.querySelectorAll('.students-results-link').length"), (await directory.list({ batch_id: String(identity.batch_id), search: identity.email || identity.student_name, status: identity.status, category: identity.category || '' })).rows.length);
    await evaluate("document.getElementById('clearStudentSearch').click()");
    await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false' && !new URLSearchParams(location.search).has('search')");
    await evaluate("history.back()");
    await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false' && !!new URLSearchParams(location.search).get('search')");
    await evaluate("history.forward()");
    await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false' && !new URLSearchParams(location.search).has('search')");
    await command('Page.navigate', { url: `${base}/students/search?q=${encodeURIComponent(identity.usn)}&batch_id=all` });
    await until("location.pathname === '/students' && document.readyState === 'complete' && !!document.querySelector('.students-results-link') && document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false'");
    assert.equal(await evaluate("document.getElementById('studentSearch').value"), identity.usn);
    await evaluate("document.querySelector('[data-act=edit]').click()");
    await until("document.getElementById('studentFormModal').classList.contains('show')");
    assert.equal(await evaluate("document.getElementById('studentUsn').value"), identity.usn);
    await pause(400);
    await fs.writeFile(path.join(output, 'students-edit.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await evaluate("bootstrap.Modal.getInstance(document.getElementById('studentFormModal')).hide()"); await pause(400);
    await evaluate("document.querySelector('[data-act=delete]').click()");
    await until("document.getElementById('studentConfirmModal').classList.contains('show')");
    assert.equal(await evaluate("document.getElementById('studentConfirmTitle').textContent"), 'Delete Student');
    assert.equal(await evaluate("document.getElementById('studentConfirmDetails').textContent.includes(" + JSON.stringify(identity.usn) + ")"), true);
    await evaluate("bootstrap.Modal.getInstance(document.getElementById('studentConfirmModal')).hide()"); await pause(400);
    const resultDestination = new URL(await evaluate("document.querySelector('.students-results-link').href"));
    assert.equal(resultDestination.pathname, '/reports/student');
    assert.equal(resultDestination.searchParams.get('batch_id'), String(identity.batch_id));
    assert.equal(resultDestination.searchParams.get('student_id'), String(identity.student_id));
    await evaluate("document.querySelector('.students-results-link').click()");
    await until(`document.getElementById('report-student_id')?.value === '${identity.student_id}'`);
    assert.equal(await evaluate("document.getElementById('report-batch_id').value"), String(identity.batch_id));
    await command('Page.navigate', { url: `${base}/students?batch_id=all` });
    await until("document.readyState === 'complete' && !!document.getElementById('studentSearch') && document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false'");
    await evaluate(`window._studentsFetch=window.fetch;let seen=0;window.fetch=async(url,options)=>{if(!String(url).includes('/students/api/list'))return window._studentsFetch(url,options);const response=await window._studentsFetch(url,{...options,signal:undefined});if(++seen===1)await new Promise(resolve=>setTimeout(resolve,1200));return response;};document.getElementById('studentSearch').value='Student';document.getElementById('studentSearch').dispatchEvent(new Event('input',{bubbles:true}))`);
    await pause(380);
    await evaluate(`document.getElementById('studentSearch').value=${JSON.stringify(identity.usn)};document.getElementById('studentSearch').dispatchEvent(new Event('input',{bubbles:true}))`);
    await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false'"); await pause(1300);
    assert.equal(await evaluate("document.querySelector('#studentsTable tbody tr').cells[1].textContent.trim()"), identity.usn);
    assert.equal(await evaluate("document.getElementById('studentSearchError').hidden"), true);
    await evaluate("window.fetch=window._studentsFetch;window._keptStudentRows=document.querySelector('#studentsTable tbody').innerHTML;window.fetch=async(url,options)=>String(url).includes('/students/api/list')?{ok:false,status:503,json:async()=>({message:'Unable to search students. Please try again.'})}:window._studentsFetch(url,options);document.getElementById('studentSearch').value='failed';document.getElementById('studentSearch').dispatchEvent(new Event('input',{bubbles:true}))");
    await until("document.getElementById('studentSearchError').hidden === false");
    assert.equal(await evaluate("document.querySelector('#studentsTable tbody').innerHTML === window._keptStudentRows"), true);
    await evaluate("window.fetch=window._studentsFetch;document.getElementById('studentSearch').value='NoSuchStudent-827319';document.getElementById('studentSearch').dispatchEvent(new Event('input',{bubbles:true}))");
    await until("document.querySelector('#studentsTable tbody').getAttribute('aria-busy') === 'false' && document.getElementById('studentResultCount').textContent === '0 students found'");
    assert.equal(await evaluate("document.querySelector('#studentsTable tbody').textContent.includes('No students matched')"), true);
    console.log('Students: cross-batch USN/name/email, combined filters, pagination, history, result links, edit/delete dialogs, stale/error/empty states and mobile themes passed (no writes)');

    const progressService = require('../services/progressAnalyticsService');
    const expectedProgress = await progressService.getProgress({ batch_id: String(scope.query.batch_id), semester: String(scope.query.semester) });
    for (const route of ['/reports', '/analytics', '/analytics/progress']) {
      await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: `${base}${route}?${new URLSearchParams(scope.query)}` });
      if (route === '/reports') {
        await until("document.querySelectorAll('.reports-launcher').length === 8");
        assert.deepEqual((await evaluate("[...document.querySelectorAll('.reports-launcher')].map(a=>new URL(a.href).pathname)")).sort(), service.TYPES.map(t => '/reports/' + t).sort());
      } else if (route === '/analytics') {
        await until("document.querySelector('[data-metric=students] .stat-value').textContent !== '\\u2014'");
        const link = new URL(await evaluate("document.querySelector('[data-analytics-target=progress]').href"));
        assert.equal(link.searchParams.get('batch_id'), String(scope.query.batch_id));
        assert.equal(link.searchParams.get('semester'), String(scope.query.semester));
        assert.equal(link.searchParams.has('session_id'), false);
        for (const chartId of ['grade-distribution-chart', 'performance-summary-chart']) {
          await until(`!!document.querySelector('#${chartId} canvas') && !!Chart.getChart(document.querySelector('#${chartId} canvas'))`);
          await evaluate(`document.getElementById('${chartId}').scrollIntoView({block:'center',behavior:'instant'})`);
          await pause(150);
          const labelCount = await evaluate(`Chart.getChart(document.querySelector('#${chartId} canvas')).data.labels.length`);
          for (let index = 0; index < Math.min(2, labelCount); index++) {
            const point = await evaluate(`(()=>{const canvas=document.querySelector('#${chartId} canvas'),chart=Chart.getChart(canvas),r=canvas.getBoundingClientRect(),bar=chart.getDatasetMeta(0).data[${index}];return {x:r.left+bar.x,y:r.top+chart.chartArea.top+2,label:chart.data.labels[${index}]};})()`);
            await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
            try {
              await until(`(()=>{const t=Chart.getChart(document.querySelector('#${chartId} canvas')).tooltip;return t.opacity===1&&t.title[0]===${JSON.stringify(point.label)};})()`);
            } catch (error) {
              console.log({ point, chart: await evaluate(`(()=>{const c=Chart.getChart(document.querySelector('#${chartId} canvas'));return {area:c.chartArea,tooltip:{opacity:c.tooltip.opacity,title:c.tooltip.title},interaction:c.options.interaction,rect:c.canvas.getBoundingClientRect().toJSON()};})()`) });
              throw error;
            }
            const tooltip = await evaluate(`(()=>{const t=Chart.getChart(document.querySelector('#${chartId} canvas')).tooltip;return {items:t.dataPoints.length,values:t.dataPoints.map(p=>p.raw)};})()`);
            assert.equal(tooltip.items, chartId === 'performance-summary-chart' ? 2 : 1);
            assert.ok(tooltip.values.every(Number.isFinite));
          }
          await fs.writeFile(path.join(output, chartId + '-moving-tooltip.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        }
        await evaluate("document.querySelector('.analytics-explore').scrollIntoView({block:'center'})");
      } else {
        await until("document.getElementById('progress-total').textContent !== '-'");
        assert.equal(Number((await evaluate("document.getElementById('progress-total').textContent")).replaceAll(',', '')), expectedProgress.summary.total);
        for (const key of ['withoutBacklog', 'withBacklog', 'uncleared', 'unknown']) assert.equal(Number(await evaluate(`document.getElementById('progress-${key}').textContent`)), expectedProgress.summary[key]);
        assert.equal(await evaluate("document.querySelectorAll('#progress-attention-body tr').length <= 20"), true);
      }
      for (const width of [1440, 1280, 768, 390]) for (const theme of ['light', 'dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`); await pause(250);
        if (await evaluate('document.documentElement.scrollWidth > innerWidth + 1')) {
          console.log(await evaluate("JSON.stringify([...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,12).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))"));
          await fs.writeFile(path.join(output, 'analytics-overflow.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
          console.log(`Overflow screenshot: ${output}`);
        }
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, `${route}: ${width} ${theme}`);
        if (width >= 1024) assert.equal(await evaluate("[...document.querySelectorAll('.sidebar-link-label')].every(e=>e.clientWidth===0||e.scrollWidth<=e.clientWidth+1)"), true, 'Sidebar labels must fit');
        if (route === '/analytics/progress' && expectedProgress.summary.total) {
          assert.equal(await evaluate("(()=>{const c=document.querySelector('#progress-status-chart canvas');return !!c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)})()"), true);
        }
        if (route === '/analytics') await evaluate("document.querySelector('.analytics-explore').scrollIntoView({block:'center'})");
        if (route === '/analytics/progress') await evaluate("document.getElementById('progress-attention-heading').scrollIntoView({block:'center'})");
        await fs.writeFile(path.join(output, `${route.replaceAll('/', '-')}-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      if (route === '/analytics/progress') {
        await evaluate("document.getElementById('progress-mode').value='effective';document.getElementById('progress-filters').requestSubmit()");
        await until("document.getElementById('progress-filters').getAttribute('aria-busy') === 'false'");
        const effective = await progressService.getProgress({ batch_id: scope.query.batch_id, semester: scope.query.semester, mode: 'effective' });
        for (const key of ['total', 'withoutBacklog', 'withBacklog', 'uncleared', 'unknown', 'clearanceRate']) {
          const expected = effective.summary[key] == null ? '-' : Number(effective.summary[key]).toLocaleString('en-US', { maximumFractionDigits: 2 }) + (key === 'clearanceRate' ? '%' : '');
          assert.equal(await evaluate(`document.getElementById('progress-${key}').textContent`), expected, `Effective ${key}`);
        }
        assert.deepEqual(await evaluate("Chart.getChart(document.querySelector('#progress-status-chart canvas')).data.datasets[0].data"), ['withoutBacklog', 'withBacklog', 'uncleared', 'unknown'].map(key => effective.summary[key]));
        assert.deepEqual(await evaluate("Chart.getChart(document.querySelector('#progress-trend-chart canvas')).data.datasets.map(d=>d.data)"), ['withoutBacklog', 'withBacklog', 'uncleared', 'unknown'].map(key => effective.trends.map(t => t[key])));
        assert.deepEqual(await evaluate("[...document.querySelectorAll('#progress-attention-body .analytics-report-action')].map(a=>({usn:a.closest('tr').cells[0].textContent,studentId:Number(new URL(a.href).searchParams.get('student_id')),mode:new URL(a.href).searchParams.get('mode')}))"), effective.attention.map(s => ({ usn: s.usn, studentId: Number(s.studentId), mode: 'effective' })));
        const reportLink = new URL(await evaluate("document.getElementById('progress-report-link').href"));
        assert.equal(reportLink.searchParams.get('mode'), 'effective');
        await evaluate("document.getElementById('progress-period').value='academic_year:1';document.getElementById('progress-filters').requestSubmit()");
        await until("document.getElementById('progress-summary-heading').textContent === 'First Year Completion'");
        const year = await progressService.getProgress({ batch_id: scope.query.batch_id, academic_year: 1, mode: 'effective' });
        for (const key of ['withoutBacklog', 'withBacklog', 'uncleared', 'unknown']) assert.equal(Number(await evaluate(`document.getElementById('progress-${key}').textContent`)), year.summary[key]);
      }
      console.log(`${route}: responsive, themes, navigation and charts passed`);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    for (const page of ['students', 'toppers', 'failed', 'subjects', 'semesters', 'revaluation']) {
      const compatible = { ...scope.query, mode: 'effective' };
      if (page === 'semesters') delete compatible.session_id;
      if (page === 'revaluation') delete compatible.mode;
      await command('Page.navigate', { url: `${base}/analytics/${page}?${new URLSearchParams(compatible)}` });
      await until(`document.getElementById('filter-batch')?.value === '${scope.query.batch_id}' && (!document.getElementById('filter-session') || document.getElementById('filter-session').value === '${scope.query.session_id}')`);
      assert.equal(await evaluate("document.getElementById('filter-semester').value"), String(scope.query.semester));
      if (page !== 'revaluation') assert.equal(await evaluate("document.getElementById('filter-mode').value"), 'effective');
      const response = await evaluate(`(async()=>{const r=await fetch('/analytics/api/${page}?${new URLSearchParams({ ...scope.query, mode: 'effective' })}',{headers:{Accept:'application/json'}});const body=await r.json();return {status:r.status,success:body.success};})()`);
      assert.equal(response.status, 200, page); assert.notEqual(response.success, false, page);
      if (page === 'students') {
        const analytics = require('../services/analyticsService');
        const query = { ...scope.query, mode: 'effective', attempt: 'latest' };
        const all = await analytics.getStudentAnalytics(query, { limit: 25, offset: 0 });
        assert.ok(all.data.length > 0);
        const student = all.data[0];
        const readRows = () => evaluate("[...document.querySelectorAll('#students-table-body tr')].filter(tr=>tr.cells.length===11).map(tr=>[tr.cells[0].textContent,tr.cells[1].textContent])");
        for (const search of [student.usn.slice(0, -2).toLowerCase(), student.studentName.split(' ')[0].toLowerCase(), 'NoSuchStudent-812739', '']) {
          await evaluate(`document.getElementById('filter-usn').value=${JSON.stringify(search)};document.getElementById('filter-usn').dispatchEvent(new Event('input',{bubbles:true}))`);
          await until("document.getElementById('students-table-body').getAttribute('aria-busy') === 'false'");
          const expected = await analytics.getStudentAnalytics({ ...query, usn: search }, { limit: 25, offset: 0 });
          assert.deepEqual(await readRows(), expected.data.map(row => [row.usn, row.studentName]));
          assert.equal(await evaluate("document.getElementById('students-page-indicator').textContent"), 'Page 1');
        }
        await evaluate("window._analyticsSearchFetch=window.fetch;let first=true;window.fetch=async(url,options)=>{if(!String(url).includes('/analytics/api/students'))return window._analyticsSearchFetch(url,options);const response=await window._analyticsSearchFetch(url,{...options,signal:undefined});if(first){first=false;await new Promise(resolve=>setTimeout(resolve,1000));}return response;};document.getElementById('filter-usn').value='NoSuchOldQuery';document.getElementById('filter-usn').dispatchEvent(new Event('input',{bubbles:true}))");
        await pause(380);
        await evaluate(`document.getElementById('filter-usn').value=${JSON.stringify(student.usn)};document.getElementById('filter-usn').dispatchEvent(new Event('input',{bubbles:true}))`);
        await until("document.getElementById('students-table-body').getAttribute('aria-busy') === 'false'");
        await pause(1200);
        assert.deepEqual(await readRows(), (await analytics.getStudentAnalytics({ ...query, usn: student.usn }, { limit: 25, offset: 0 })).data.map(row => [row.usn, row.studentName]));
        await evaluate("window.fetch=window._analyticsSearchFetch");
        await fs.writeFile(path.join(output, 'analytics-students-partial-search.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        console.log('Analytics Students: partial USN/name, live typing, clearing, empty state and stale-response protection passed');
      }
      if (page === 'failed') {
        const analytics = require('../services/analyticsService');
        const readFailures = () => evaluate("[...document.querySelectorAll('#failed-table-body tr')].filter(tr=>tr.cells.length===7).map(tr=>{const c=tr.cells;return [c[0].textContent,c[1].textContent,c[2].textContent,c[3].textContent,c[4].textContent,c[5].querySelector('.analytics-status').lastChild.textContent.trim().toLowerCase(),c[6].querySelector('.analytics-status').lastChild.textContent.trim().toLowerCase()]})");
        const expectedRows = data => data.map(r => [r.usn, r.studentName, r.subjectName,
          r.originalMarks == null ? '\u2014' : Number(r.originalMarks).toFixed(2),
          r.effectiveMarks == null ? '\u2014' : Number(r.effectiveMarks).toFixed(2),
          r.originalStatus || '\u2014', r.effectiveStatus || '\u2014']);
        for (const mode of ['original', 'effective']) {
          await until("!document.querySelector('#analytics-filter-form [type=submit]').disabled");
          await evaluate(`document.getElementById('filter-mode').value='${mode}';document.getElementById('filter-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
          await until(`document.getElementById('failed-table-body').getAttribute('aria-busy')==='false' && document.getElementById('analytics-mode-label').textContent==='${mode === 'original' ? 'Original' : 'Effective'}' && !document.querySelector('#analytics-filter-form [type=submit]').disabled`);
          const expected = await analytics.getFailedStudents({ ...scope.query, mode }, { limit: 50 });
          assert.deepEqual(await readFailures(), expectedRows(expected.data), `${mode}: every displayed original/effective value agrees with API`);
        }
        await evaluate("window.savedFailedFetch=window.fetch;window.delayedFailedRequests=0;window.fetch=async(...args)=>{const response=await window.savedFailedFetch(...args);if(String(args[0]).includes('/analytics/api/failed')&&String(args[0]).includes('mode=original')){window.delayedFailedRequests++;await new Promise(r=>setTimeout(r,400));}return response;}");
        await evaluate("document.getElementById('filter-mode').value='original';document.getElementById('filter-mode').dispatchEvent(new Event('change',{bubbles:true}))");
        await until('window.delayedFailedRequests > 0');
        await evaluate("document.getElementById('filter-mode').value='effective';document.getElementById('filter-mode').dispatchEvent(new Event('change',{bubbles:true}))");
        await until("document.getElementById('failed-table-body').getAttribute('aria-busy')==='false' && document.getElementById('analytics-mode-label').textContent==='Effective'");
        await pause(450);
        const effectiveRows = await analytics.getFailedStudents({ ...scope.query, mode: 'effective' }, { limit: 50 });
        assert.deepEqual(await readFailures(), expectedRows(effectiveRows.data), 'Delayed Original response cannot overwrite Effective results');
        await evaluate('window.fetch=window.savedFailedFetch');
        assert.equal(await evaluate(`Array.from(document.getElementById('filter-subject').options).some(o=>o.value==='${scope.subjects[0].subject_id}')`), true, 'Subject filter is populated');
        await evaluate(`document.getElementById('filter-subject').value='${scope.subjects[0].subject_id}';document.getElementById('filter-subject').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('analytics-filter-form').requestSubmit()`);
        await until("document.getElementById('failed-table-body').getAttribute('aria-busy')==='false'");
        const subjectRows = await analytics.getFailedStudents({ ...scope.query, mode: 'effective', subject_id: scope.subjects[0].subject_id }, { limit: 50 });
        assert.deepEqual(await readFailures(), expectedRows(subjectRows.data), 'Subject filter applies to the displayed outcomes');
        console.log('failed: all displayed values, both modes, subject filtering and delayed-response protection passed');
      }
      console.log(`${page}: Analytics API and compatible deep-link filters passed`);
    }
    for (const type of service.TYPES) {
      await command('Page.navigate', { url: `${base}/reports/${type}` });
      await available('batch_id');
      await choose('batch_id', scope.query.batch_id);
      if (type === 'student') {
        await available('student_id');
        const identity = selectedStudent.student;
        for (const search of [identity.usn.slice(0, -2).toLowerCase(), identity.student_name.split(' ')[0].toLowerCase(), 'NoSuchStudent-819237', '']) {
          await evaluate(`document.getElementById('report-student-search').value=${JSON.stringify(search)};document.getElementById('report-student-search').dispatchEvent(new Event('input',{bubbles:true}))`);
          await until("!['Searching students...','Loading filters...'].includes(document.getElementById('reports-filter-state').textContent) && document.getElementById('report-student_id').options[0].textContent !== 'Loading...'");
          const matches = await service.getOptions('students', { batch_id: scope.query.batch_id, search });
          assert.deepEqual(await evaluate("[...document.getElementById('report-student_id').options].filter(o=>o.value).map(o=>o.value)"), matches.map(row => String(row.student_id)));
          if (matches.length !== 1 || !search) assert.equal(await evaluate("document.getElementById('report-student_id').value"), '');
          if (!matches.length) assert.equal(await evaluate("document.getElementById('reports-generate').disabled"), true);
        }
        await evaluate("window._reportSearchFetch=window.fetch;let first=true;window.fetch=async(url,options)=>{if(!String(url).includes('/students?'))return window._reportSearchFetch(url,options);const response=await window._reportSearchFetch(url,{...options,signal:undefined});if(first){first=false;await new Promise(resolve=>setTimeout(resolve,1000));}return response;};document.getElementById('report-student-search').value='NoSuchOldStudent';document.getElementById('report-student-search').dispatchEvent(new Event('input',{bubbles:true}))");
        await pause(380);
        await evaluate(`document.getElementById('report-student-search').value=${JSON.stringify(identity.usn)};document.getElementById('report-student-search').dispatchEvent(new Event('input',{bubbles:true}))`);
        await until(`document.getElementById('report-student_id').value === '${identity.student_id}' && !document.getElementById('report-session_id').disabled && !document.getElementById('reports-generate').disabled`);
        await pause(1200);
        assert.equal(await evaluate("document.getElementById('report-student_id').value"), String(identity.student_id));
        assert.equal(await evaluate("document.getElementById('reports-error').hidden"), true);
        assert.equal(await evaluate("document.getElementById('report-semester').value"), 'all');
        await evaluate("window.fetch=window._reportSearchFetch");
        await fs.writeFile(path.join(output, 'student-report-live-search.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        console.log('Student Result: partial USN/name, live options, single-match periods, ambiguity, clearing, empty state and stale-response protection passed');
        await choose('student_id', selectedStudent.student.student_id);
        await available('semester'); await available('session_id');
        assert.equal(await evaluate("document.getElementById('report-semester').value"), 'all');
        assert.equal(await evaluate("document.getElementById('report-session_id').value"), 'all');
        assert.equal(await evaluate("document.getElementById('report-attempt_no').disabled"), true);
        await until("!document.getElementById('reports-generate').disabled");
        await evaluate("document.getElementById('reports-generate').click()");
        await until("!document.getElementById('reports-output').hidden");
        const all = await service.getReport('student', { batch_id: scope.query.batch_id, student_id: String(selectedStudent.student.student_id), semester: 'all', session_id: 'all' });
        assert.equal(await evaluate("document.querySelectorAll('#reports-semesters > .reports-semester').length"), all.semesters.length);
        assert.deepEqual(await evaluate("[...document.querySelectorAll('#reports-semesters > .reports-semester > h3')].map(e=>e.textContent)"), all.semesters.map(term => `Semester ${term.semester}`));
        if (all.semesters.length > 1) {
          assert.equal(await evaluate("(()=>{const a=[...document.querySelectorAll('#reports-semesters > .reports-semester')];return a[1].getBoundingClientRect().left>a[0].getBoundingClientRect().left})()"), true);
          assert.equal(await evaluate("document.getElementById('reports-semesters').scrollWidth > document.getElementById('reports-semesters').clientWidth"), true);
        }
        await fs.writeFile(path.join(output, 'student-consolidated-desktop.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await pause(350);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
        await evaluate("document.getElementById('reports-output').scrollIntoView()");
        await fs.writeFile(path.join(output, 'student-consolidated-mobile.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        if (all.semesters.length > 1) {
          await evaluate("document.getElementById('reports-semesters').scrollLeft=800");
          await pause(300);
          assert.equal(await evaluate("document.getElementById('reports-semesters').scrollLeft > 0"), true);
        }
        const printed = await evaluate("(async()=>{const html=await(await fetch(document.getElementById('reports-print').href)).text();return new DOMParser().parseFromString(html,'text/html').querySelectorAll('.reports-semester').length})()");
        assert.equal(printed, all.semesters.length);
        await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
        await pause(350);
        await evaluate('window.scrollTo(0,0)');
      }
      if (type !== 'student-progress') {
        await available('semester'); await choose('semester', scope.query.semester);
        await available('session_id'); await choose('session_id', scope.query.session_id);
      }
      if (type === 'student') {
        await available('attempt_no');
        if (selectedStudent.attempts.length > 1) {
          assert.equal(await evaluate("document.getElementById('reports-generate').disabled"), true);
          await choose('attempt_no', selectedStudent.attempts[0].attempt_no);
        }
      }
      if (type === 'subject') { await available('subject_id'); await choose('subject_id', scope.subjects[0].subject_id); }
      if (type === 'revaluation') await available('subject_id');
      await until("!document.getElementById('reports-generate').disabled");
      await evaluate("document.getElementById('reports-generate').click()");
      await until("!document.getElementById('reports-output').hidden || !document.getElementById('reports-error').hidden");
      assert.equal(await evaluate("document.getElementById('reports-error').hidden"), true);
      assert.equal(await evaluate("document.querySelectorAll('#reports-table th').length > 1"), true);
      assert.equal(await evaluate("document.querySelector('#menu-reports').classList.contains('show')"), true);
      if (type === 'student-progress') {
        const progress = await service.getReport(type, { batch_id: scope.query.batch_id });
        assert.equal(await evaluate("document.getElementById('report-semester') === null && document.getElementById('report-session_id') === null"), true);
        assert.equal(await evaluate("document.querySelectorAll('#reports-table th[colspan=\"5\"]').length"), progress.semesters.length);
        assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#reports-table .reports-completion-group')).map(th=>th.colSpan)"), progress.completionGroups.map(g=>g.columns.length));
        assert.equal(await evaluate("document.querySelectorAll('#reports-table thead .reports-year-completion').length"), progress.academicYears.length * 2);
        assert.equal(await evaluate("/Sem \\d+ (With|Without) Backlog/.test(document.querySelector('#reports-table thead').textContent)"), false);
        assert.equal(await evaluate("document.querySelectorAll('#reports-table tbody tr').length"), progress.rows.length);
        assert.equal(await evaluate("document.getElementById('reports-flat-table').scrollWidth > document.getElementById('reports-flat-table').clientWidth"), true);
        for (const theme of ['light', 'dark']) {
          await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
          const before = await evaluate("document.querySelector('#reports-table tbody .reports-fixed-3').getBoundingClientRect().left");
          await evaluate("document.getElementById('reports-flat-table').scrollLeft=600");
          await pause(150);
          assert.ok(Math.abs(await evaluate("document.querySelector('#reports-table tbody .reports-fixed-3').getBoundingClientRect().left") - before) < 2);
          await evaluate("document.getElementById('reports-flat-table').scrollLeft=0");
        }
        await evaluate("document.documentElement.setAttribute('data-theme','light')");
        if (progress.pagination.totalPages > 1) {
          await evaluate("document.getElementById('reports-next').click()");
          await until("document.getElementById('reports-page-info').textContent.startsWith('Page 2') && document.getElementById('reports-loading').hidden");
          assert.equal(await evaluate("document.querySelector('#reports-table tbody td').textContent"), '26');
        }
        const count = await evaluate("(async()=>{const html=await(await fetch(document.getElementById('reports-print').href)).text();return new DOMParser().parseFromString(html,'text/html').querySelectorAll('tbody tr').length})()");
        assert.equal(count, progress.pagination.totalRows);
        const csv = await evaluate("(async()=>await(await fetch(document.getElementById('reports-csv').href)).text())()");
        assert.ok(csv.includes(`\r\n${progress.pagination.totalRows},`));
        assert.ok(csv.includes('Successfully Completed With Back Log - First Year'));
        for (const column of progress.completionColumns) assert.ok(csv.includes(column.label));
        assert.doesNotMatch(csv, /Sem \d+ (With|Without) Backlog/);
        await evaluate("document.getElementById('reports-flat-table').scrollLeft=document.getElementById('reports-flat-table').scrollWidth");
        await fs.writeFile(path.join(output, 'progress-year-completion-desktop.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await evaluate("document.getElementById('reports-flat-table').scrollLeft=0");
      }
      if (type === 'result-analysis') {
        await until('window.reportChartReady === true');
        const analysis = await service.getReport('result-analysis', scope.query);
        assert.equal(await evaluate("document.querySelectorAll('#reports-table thead tr').length"), 2);
        assert.equal(await evaluate("document.querySelectorAll('#reports-table tbody tr').length"), scope.subjects.length);
        assert.equal(await evaluate("document.querySelectorAll('#reports-table th[colspan=\"3\"]').length"), 3);
        assert.equal(await evaluate("document.getElementById('reports-pagination').hidden"), true);
        assert.equal(await evaluate("document.getElementById('report-pageSize') === null"), true);
        assert.deepEqual(await evaluate("Chart.getChart(document.getElementById('reports-analysis-chart')).data.datasets[0].data"), analysis.chart.values);
        assert.equal(await evaluate("(()=>{const c=document.getElementById('reports-analysis-chart');const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return pixels.some((value,index)=>index%4===3&&value>0)})()"), true);
        await evaluate("document.getElementById('reports-analysis-chart').scrollIntoView()");
        await fs.writeFile(path.join(output, 'result-analysis-chart.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await evaluate('window.scrollTo(0,0)');
      }
      if (type === 'toppers') {
        assert.deepEqual(await evaluate("[...document.querySelectorAll('#reports-table th')].map(e=>e.textContent)"), ['Rank', 'USN', 'Student Name', 'Attempt No.', 'Exam Type', 'Subjects', 'Passed', 'Total', 'SGPA', 'CGPA', '% Percentage', 'Result']);
      }
      if (type === 'consolidated') {
        assert.equal(await evaluate("document.querySelectorAll('#reports-table thead tr').length"), 2);
        assert.equal(await evaluate("document.querySelectorAll('#reports-table th[colspan=\"3\"]').length"), scope.subjects.length);
        assert.equal(await evaluate("document.getElementById('reports-flat-table').scrollWidth > document.getElementById('reports-flat-table').clientWidth"), true);
        const before = await evaluate("document.querySelector('#reports-table tbody .reports-fixed-1').getBoundingClientRect().left");
        await evaluate("document.getElementById('reports-flat-table').scrollLeft=500");
        await pause(150);
        assert.ok(Math.abs(await evaluate("document.querySelector('#reports-table tbody .reports-fixed-1').getBoundingClientRect().left") - before) < 2);
        await evaluate("document.getElementById('reports-flat-table').scrollLeft=0");
      }
      if (type === 'class' || type === 'consolidated') {
        assert.equal(await evaluate("document.querySelectorAll('#reports-table tbody tr').length"), Math.min(25, scope.totalRows));
        if (scope.totalRows > 25) {
          await evaluate("document.getElementById('reports-next').click()");
          await until("!document.getElementById('reports-loading').hidden === false && document.getElementById('reports-page-info').textContent.startsWith('Page 2')");
          assert.equal(await evaluate("document.querySelector('#reports-table tbody td').textContent"), '26');
        }
        const printRows = await evaluate("(async()=>{ const html=await (await fetch(document.getElementById('reports-print').href)).text();const d=new DOMParser().parseFromString(html,'text/html');return d.querySelectorAll('tbody tr').length;})()");
        assert.equal(printRows, scope.totalRows);
        const csvText = await evaluate("(async()=>await (await fetch(document.getElementById('reports-csv').href)).text())()");
        assert.ok(csvText.includes(`\r\n${scope.totalRows},`), 'CSV includes the final filtered row while preview is on page 2');
      }
      await fs.writeFile(path.join(output, `${type}-desktop.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await pause(350);
      assert.equal(await evaluate('window.innerWidth'), 390);
      if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) {
        console.log(await evaluate("JSON.stringify([...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed'}).slice(0,15).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))"));
        await fs.writeFile(path.join(output, `${type}-overflow.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        console.log(`Overflow screenshot: ${output}`);
      }
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, `${type} page should not overflow on mobile`);
      if (type === 'student-progress') {
        await evaluate("document.getElementById('reports-flat-table').scrollIntoView()");
        const before = await evaluate("document.querySelector('#reports-table tbody .reports-fixed-1').getBoundingClientRect().left");
        await evaluate("document.getElementById('reports-flat-table').scrollLeft=650");
        await pause(150);
        assert.ok(Math.abs(await evaluate("document.querySelector('#reports-table tbody .reports-fixed-1').getBoundingClientRect().left") - before) < 2);
      }
      await fs.writeFile(path.join(output, `${type}-mobile.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await evaluate("document.documentElement.setAttribute('data-theme','dark')");
      await pause(350);
      await fs.writeFile(path.join(output, `${type}-mobile-dark.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
      await pause(350);
      if (type !== 'revaluation') {
        await choose('mode', 'original');
        assert.equal(await evaluate("document.getElementById('reports-output').hidden"), true);
        await evaluate("document.getElementById('reports-generate').click()");
        await until("!document.getElementById('reports-output').hidden");
        assert.match(await evaluate("document.getElementById('reports-view').textContent"), /Original/);
      }
      await choose('batch_id', '');
      assert.equal(await evaluate(type === 'student-progress' ? "document.getElementById('reports-output').hidden && document.getElementById('reports-generate').disabled" : "document.getElementById('reports-output').hidden && document.getElementById('report-session_id').disabled && document.getElementById('reports-generate').disabled"), true);
      console.log(`${type}: cascading filters, preview, theme, mobile and reset passed`);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await command('Page.navigate', { url: `${base}/reports/class/print?${new URLSearchParams(scope.query)}` });
    await until("document.body.classList.contains('reports-print') && document.querySelectorAll('tbody tr').length > 0");
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), scope.totalRows);
    const pdf = await command('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
    assert.ok(Buffer.from(pdf.data, 'base64').length > 1000);
    await fs.writeFile(path.join(output, 'class-full-print.pdf'), Buffer.from(pdf.data, 'base64'));
    await command('Page.navigate', { url: `${base}/reports/consolidated/print?${new URLSearchParams(scope.query)}` });
    await until("document.body.classList.contains('reports-print') && document.querySelectorAll('tbody tr').length > 0");
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), scope.totalRows);
    assert.equal(await evaluate("document.querySelectorAll('thead tr').length"), 2);
    await until("getComputedStyle(document.querySelector('tbody .reports-student-name')).textAlign === 'left'");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('thead .reports-student-name')).textAlign"), 'left');
    const consolidatedPdf = await command('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(path.join(output, 'consolidated-full-print.pdf'), Buffer.from(consolidatedPdf.data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: 'print' });
    assert.equal(await evaluate("[...document.querySelectorAll('.reports-student-name')].every(cell=>getComputedStyle(cell).textAlign === 'left')"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('tbody tr').lastElementChild).textAlign"), 'center');
    await fs.writeFile(path.join(output, 'consolidated-print.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: '' });
    await command('Page.navigate', { url: `${base}/reports/result-analysis/print?${new URLSearchParams(scope.query)}` });
    await until('window.reportChartReady === true');
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), scope.subjects.length);
    assert.deepEqual(await evaluate("Chart.getChart(document.getElementById('reports-analysis-chart')).data.datasets[0].data"), (await service.getReport('result-analysis', scope.query)).chart.values);
    const analysisPdf = await command('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(path.join(output, 'result-analysis-print.pdf'), Buffer.from(analysisPdf.data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: 'print' });
    await fs.writeFile(path.join(output, 'result-analysis-print.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: '' });
    const studentQuery = { batch_id: scope.query.batch_id, student_id: String(selectedStudent.student.student_id), semester: 'all', session_id: 'all' };
    await command('Page.navigate', { url: `${base}/reports/student-progress/print?batch_id=${scope.query.batch_id}` });
    await until("document.body.classList.contains('reports-progress-print') && document.querySelectorAll('tbody tr').length > 0");
    const progressPdf = await command('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.reports-completion-group')).map(th=>th.colSpan)"), (await service.getReport('student-progress', { batch_id: scope.query.batch_id })).completionGroups.map(g=>g.columns.length));
    await fs.writeFile(path.join(output, 'student-progress-print.pdf'), Buffer.from(progressPdf.data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: 'print' });
    await fs.writeFile(path.join(output, 'student-progress-print.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: '' });
    const studentReport = await service.getReport('student', studentQuery);
    await command('Page.navigate', { url: `${base}/reports/student/print?${new URLSearchParams(studentQuery)}` });
    await until("document.body.classList.contains('reports-print') && document.querySelectorAll('.reports-semester').length > 0");
    assert.equal(await evaluate("document.querySelectorAll('.reports-semester').length"), studentReport.semesters.length);
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), studentReport.rows.length);
    const studentPdf = await command('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
    assert.ok(Buffer.from(studentPdf.data, 'base64').length > 1000);
    await fs.writeFile(path.join(output, 'student-consolidated-print.pdf'), Buffer.from(studentPdf.data, 'base64'));
    await fs.writeFile(path.join(output, 'student-consolidated-print.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Page.navigate', { url: `${base}/subjects/courses?batch_id=${scope.query.batch_id}&semester=${scope.query.semester}` });
    await until("document.querySelectorAll('input[name=required_courses]').length > 0");
    assert.equal(await evaluate("document.querySelector('input[name=confirm]').required"), true);
    await fs.writeFile(path.join(output, 'semester-courses-desktop.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command('Page.navigate', { url: `${base}/subjects/courses?batch_id=${scope.query.batch_id}&semester=${scope.query.semester}` });
    await until("document.querySelector('input[name=confirm]') !== null");
    await evaluate("document.documentElement.setAttribute('data-theme','dark')");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    await fs.writeFile(path.join(output, 'semester-courses-mobile-dark.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log('semester courses: required-roster form and responsive layout passed (no database writes)');
    const settingsRepository = require('../repositories/settingsRepository');
    const settingsService = require('../services/settingsService');
    const originalSettings = { ...settingsRepository };
    restoreSettings = () => Object.assign(settingsRepository, originalSettings);
    const settingsAccount = { admin_id: 1, username: 'Settings Verification', email: 'settings@example.com', role: 'admin', status: 'active', last_login: new Date() };
    const brandingValues = new Map(), brandingAudits = [];
    settingsRepository.account = async () => settingsAccount;
    settingsRepository.emailTaken = async () => false;
    settingsRepository.updateEmail = async (id, email) => { settingsAccount.email = email; return [1]; };
    settingsRepository.values = async () => [...brandingValues].map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
    settingsRepository.audit = async () => brandingAudits;
    settingsRepository.save = async (updates, actor) => {
      for (const [key, value] of Object.entries(updates)) {
        brandingAudits.push({ setting_key: key, old_value: brandingValues.get(key) ?? null, new_value: value, changed_by: actor, changed_at: new Date() });
        brandingValues.set(key, value);
        if (key === 'institution_logo' && value) testLogoPaths.push(value);
      }
    };
    for (const section of ['account', 'security', 'appearance', 'institution', 'academic-policy', 'system']) {
      await command('Page.navigate', { url: `${base}/settings?section=${section}` });
      await until("!!document.querySelector('.settings-page')");
      assert.equal(await evaluate("document.querySelector('.admin-name').textContent.includes('Settings Verification')"), true);
      assert.equal(await evaluate("document.querySelector('.dropdown-menu a[href=\"/account-security\"]') === null"), true);
      if (section === 'security') {
        await until("!!document.querySelector('[data-password-toggle]')");
        for (const name of ['currentPassword', 'newPassword', 'confirmPassword']) {
          assert.equal(await evaluate(`document.querySelector('[data-password-toggle="${name}"]').hidden`), true);
          await evaluate(`document.getElementById('${name}').value='TestPassword1';document.getElementById('${name}').dispatchEvent(new Event('input',{bubbles:true}))`);
          assert.equal(await evaluate(`document.querySelector('[data-password-toggle="${name}"]').hidden`), false);
          await evaluate(`document.querySelector('[data-password-toggle="${name}"]').click()`);
          assert.equal(await evaluate(`document.getElementById('${name}').type`), 'text');
          assert.equal(await evaluate(`document.querySelector('[data-password-toggle="${name}"]').getAttribute('aria-pressed')`), 'true');
          await evaluate(`document.querySelector('[data-password-toggle="${name}"]').click()`);
          assert.equal(await evaluate(`document.getElementById('${name}').type`), 'password');
          await evaluate(`document.querySelector('[data-password-toggle="${name}"]').click();document.getElementById('${name}').value='';document.getElementById('${name}').dispatchEvent(new Event('input',{bubbles:true}))`);
          assert.equal(await evaluate(`document.querySelector('[data-password-toggle="${name}"]').hidden`), true);
          assert.equal(await evaluate(`document.getElementById('${name}').type`), 'password');
        }
      }
      for (const width of [1440, 1280, 768, 390]) for (const theme of ['light', 'dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await evaluate(`window.setThemePreference('${theme}')`); await pause(200);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, `Settings ${section} ${width} ${theme}`);
        await fs.writeFile(path.join(output, `settings-${section}-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      if (section === 'appearance') {
        await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        await evaluate("document.getElementById('theme-system').click()");
        await until("document.documentElement.dataset.theme === 'dark'");
        assert.equal(await evaluate("localStorage.getItem('sraas-theme')"), 'system');
        await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        try { await until("document.documentElement.dataset.theme === 'light'"); }
        catch (error) { console.log(await evaluate("({preference:window.getThemePreference(),stored:localStorage.getItem('sraas-theme'),dark:matchMedia('(prefers-color-scheme: dark)').matches,theme:document.documentElement.dataset.theme})")); throw error; }
        assert.equal(await evaluate("localStorage.getItem('sraas-theme')"), 'system');
        await evaluate('window.toggleTheme()');
        assert.equal(await evaluate("document.getElementById('theme-dark').checked"), true);
        assert.equal(await evaluate("document.cookie.includes('themePreference=dark')"), true);
      }
      console.log(`settings/${section}: responsive, theme and section navigation passed`);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await command('Page.navigate', { url: `${base}/profile` });
    await until("location.pathname === '/settings' && location.search.includes('section=account')");
    await evaluate("document.getElementById('account-email').value='updated@example.com';document.querySelector('form[action=\"/settings/account\"]').requestSubmit()");
    await until("document.querySelector('[data-settings-notification]')?.textContent.includes('updated')");
    assert.equal(settingsAccount.email, 'updated@example.com');
    await command('Page.navigate', { url: `${base}/settings?section=institution` });
    await until("!!document.getElementById('institution-form')");
    await evaluate("document.getElementById('setting-institution_name').value='Browser Test College';document.getElementById('setting-report_footer').value='Verified report branding';document.getElementById('institution-form').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await evaluate("document.querySelector('#settings-branding [data-branding-field=institution_name]').textContent"), 'Browser Test College');
    await evaluate("document.getElementById('institution-form').requestSubmit()");
    await until("document.querySelector('[data-settings-notification]')?.textContent.includes('saved')");
    await until("(()=>{const toast=document.querySelector('[data-settings-notification]');if(!toast)return false;const rect=toast.getBoundingClientRect(),header=document.querySelector('.app-header').getBoundingClientRect(),width=document.documentElement.clientWidth;return getComputedStyle(toast).position==='fixed'&&rect.top>=header.bottom&&rect.right<=width&&rect.right>=width-20})()");
    await fs.writeFile(path.join(output, 'settings-success-notification.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await pause(5200);
    assert.equal(await evaluate("document.querySelector('[data-settings-notification]') === null"), true);
    assert.equal(brandingValues.get('institution_name'), 'Browser Test College');
    const logoBuffer = await require('sharp')({ create: { width: 32, height: 32, channels: 3, background: '#168a78' } }).png().toBuffer();
    await evaluate(`(async()=>{const bytes=Uint8Array.from(atob('${logoBuffer.toString('base64')}'),c=>c.charCodeAt(0)),form=new FormData();form.set('_csrf',document.querySelector('[name=_csrf]').value);form.set('logo',new Blob([bytes],{type:'image/png'}),'logo.png');const response=await fetch('/settings/logo',{method:'POST',body:form});if(!response.ok)throw new Error('Logo upload failed');})()`);
    await command('Page.navigate', { url: `${base}/settings?section=institution` });
    await until("document.querySelector('#settings-branding img')?.naturalWidth > 0");
    assert.equal(brandingAudits.some(a => a.setting_key === 'institution_logo' && a.changed_by === 1), true);
    for (const type of service.TYPES) {
      const query = type === 'student-progress' ? { batch_id: scope.query.batch_id } : type === 'student' ? { ...scope.query, student_id: String(selectedStudent.student.student_id), attempt_no: String(selectedStudent.attempts[0].attempt_no) } : { ...scope.query, ...(type === 'subject' ? { subject_id: String(scope.subjects[0].subject_id) } : {}) };
      const expected = await service.getReport(type, query);
      const api = await (await fetch(`${base}/reports/api/${type}?${new URLSearchParams(query)}`)).json();
      assert.deepEqual(api.report.rows, JSON.parse(JSON.stringify(expected.rows)), `${type}: branding preserves rows`);
      assert.deepEqual(api.report.metrics, expected.metrics, `${type}: branding preserves metrics`);
      assert.equal(api.report.branding.institution_name, 'Browser Test College');
      const printed = await (await fetch(`${base}/reports/${type}/print?${new URLSearchParams(query)}`)).text();
      assert.ok(printed.includes('Browser Test College')); assert.ok(printed.includes('Verified report branding')); assert.ok(printed.includes(brandingValues.get('institution_logo')));
      const csv = await (await fetch(`${base}/reports/${type}/export.csv?${new URLSearchParams(query)}`)).text();
      assert.ok(csv.includes('Institution,Browser Test College')); assert.ok(csv.includes('Report Footer,Verified report branding'));
    }
    await command('Page.navigate', { url: `${base}/reports/class?${new URLSearchParams(scope.query)}` });
    await until("document.getElementById('report-session_id').value === '" + scope.query.session_id + "'");
    await evaluate("document.getElementById('reports-generate').click()");
    await until("!document.getElementById('reports-output').hidden");
    assert.equal(await evaluate("document.querySelector('#reports-branding [data-branding-field=institution_name]').textContent"), 'Browser Test College');
    assert.equal(await evaluate("document.getElementById('reports-brand-footer').textContent"), 'Verified report branding');
    assert.equal(await evaluate("document.querySelector('#reports-branding img').naturalWidth > 0"), true);
    await fs.writeFile(path.join(output, 'settings-branded-report.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log('Settings: profile, email, System preference, preview, logo, audit and branding on all eight reports passed (no database writes)');
    assert.deepEqual(exceptions, []);
    console.log(`Screenshots: ${output}`);
  } finally {
    if (restoreSettings) restoreSettings();
    for (const logo of testLogoPaths) {
      assert.ok(/^\/uploads\/branding\/[a-f0-9-]{36}\.png$/.test(logo));
      await fs.unlink(path.join(__dirname, '..', logo)).catch(() => {});
    }
    socket?.close();
    browser.kill();
    await new Promise(resolve => server.close(resolve));
    await sequelize.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
