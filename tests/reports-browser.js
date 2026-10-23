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
  const editSessionFixture = { exam_session_id: 9100, batch_id: 9001, semester: '1', exam_session: 'Jan', exam_year: 2000, Batch: editBatchFixture };
  const editSubjectFixture = { subject_id: 9200, exam_session_id: 9100, course_id: 9300, subject_code: 'VERIFY', subject_name: 'Verification Project', subject_type: 'project', credits: 0, max_internal: 0, max_external: 100, max_marks: 100 };
  const verificationWrites = [];
  const rosterFixtureCourses = [{ course_id: 9400, subject_code: 'VERIFY', subject_name: 'Required course', credits: 4, max_marks: 100, is_required: true }, { course_id: 9401, subject_code: 'EXTRA', subject_name: 'Course to exclude', credits: 3, max_marks: 100, is_required: true }];
  const assignmentFaculty = [1, 2, 3, 4].map(faculty_id => ({ faculty_id, faculty_name: 'Test Faculty ' + faculty_id, status: 'active' }));
  let emptyFacultyFixture = false;
  const assignmentSubjects = [{ ...editSubjectFixture, Faculties: [assignmentFaculty[0]] }, { ...editSubjectFixture, subject_id: 9201, subject_code: 'OTHER', subject_name: 'Unassigned Subject', Faculties: [] }];
  app.use((req, res, next) => {
    if (!/\/verification\/(sessions|subjects|faculty|roster)/.test(req.get('referer') || '')) return next();
    if (req.method === 'POST' && req.path === '/subjects/roster' && (req.get('referer') || '').includes('/verification/roster')) {
      verificationWrites.push({ path: req.path, body: req.body });
      const ids = [req.body.required_courses || []].flat().map(String);
      rosterFixtureCourses.forEach(course => { course.is_required = ids.includes(String(course.course_id)); });
      return res.redirect('/verification/roster?verified=1&saved=1');
    }
    if (req.method === 'POST' && req.path === '/subjects' && (req.get('referer') || '').includes('/verification/subjects')) {
      verificationWrites.push({ path: req.path, body: req.body });
      return res.status(201).json({ success: true, data: { ...req.body, subject_id: 9202 } });
    }
    if ((req.get('referer') || '').includes('/verification/faculty')) {
      if (req.method === 'GET' && req.path === '/faculty/api') return res.json({ data: emptyFacultyFixture ? [] : assignmentFaculty });
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
    if (req.method === 'GET' && req.path === '/exam-sessions') return res.json({ success: true, data: [editSessionFixture] });
    if (req.method === 'GET' && req.path === '/subjects/session/9100') return res.json([editSubjectFixture]);
    if (req.method === 'PUT' && ['/exam-sessions/9100', '/subjects/9200'].includes(req.path)) {
      verificationWrites.push({ path: req.path, body: req.body });
      const data = Object.assign(req.path.startsWith('/exam-sessions') ? editSessionFixture : editSubjectFixture, req.body);
      return res.json({ success: true, data });
    }
    return next();
  });
  app.use(require('./fixtures/workspace-pages').api);
  app.get('/verification/workspace/:page', (req, res) => {
    const fixture = require('./fixtures/workspace-pages');
    const page = fixture.pages[req.params.page];
    if (!page) return res.sendStatus(404);
    return res.render(page[0], { ...fixture.base, ...page[1] });
  });
  app.use('/reports', require('../routes/reportsRoutes'));
  app.use('/analytics', require('../routes/analyticsRoutes'));
  app.use('/subjects', require('../routes/subjectRoutes'));
  app.use('/students', require('../routes/studentRoutes'));
  app.use('/batches', require('../routes/batchRoutes'));
  app.use('/exam-sessions', require('../routes/examSessionRoutes'));
  app.use('/faculty', require('../routes/facultyRoutes'));

  if (process.env.MARKS_CARD_IMAGES_ONLY === '1') {
    app.get('/results/session-details/9000', (req,res) => res.json({
      success:true, session:{academic_year:'2025-2027',semester:'1',exam_session:'Jun',exam_year:2026,subjects_count:1,
        subjects:[{subject_code:'MMC101',subject_name:'PROGRAMMING',credits:4}]}
    }));
    app.get('/verification/marks-card.png', (req,res) => {
      const canvas = require('@napi-rs/canvas').createCanvas(1000,1100);
      const context=canvas.getContext('2d');
      context.fillStyle='#fff';context.fillRect(0,0,1000,1100);
      context.fillStyle='#111';context.font='bold 34px Arial';
      context.fillText('UNIVERSITY RESULT CARD',60,90);
      context.font='26px Arial';
      ['University Seat Number: 1MV25MC001','Student Name: TEST STUDENT','Semester: 1',
        'Subject       Internal    External    Total    Result',
        'MMC101          40             40           80        P'].forEach((line,i)=>context.fillText(line,60,180+i*85));
      context.strokeStyle='#999';context.strokeRect(40,350,920,200);
      res.type('png').send(canvas.toBuffer('image/png'));
    });
  }
  app.use('/results', require('../routes/resultRoutes'));
  app.use('/dashboard', require('../routes/dashboardRoutes'));
  app.get('/verification/result-management/:page', async (req, res) => {
    const fixture = require('./fixtures/result-management-pages');
    const page = fixture.pages[req.params.page];
    if (!page) return res.sendStatus(404);
    const locals = { ...fixture.base, ...page[1] };
    if (req.query.identity === 'mismatch') {
      const message = 'Student name does not match USN 1MV25MC004. Registered name: AMRUTHA S. Correct the Student Name or USN, then click Validate again.';
      locals.student = {usn:'1MV25MC004',name:'AMRUTHA SLOP'};
      locals.errors = {'student.name':message}; locals.formError=message;
    }
    if (req.query.image === '1') {
      locals.fileUrl = '/verification/marks-card.png'; locals.fileType = 'png';
      locals.meta = { ...locals.meta, docType:'png',docUrl:'/verification/marks-card.png' };
    }
    if (['review', 'blocked'].includes(req.params.page) && req.query.rows === '8') {
      const names = ['ABILITY ENHANCEMENT COURSES WITH SEMINAR-I', 'MACHINE LEARNING AND DATA ANALYTICS USING PYTHON', 'OBJECT ORIENTED PROGRAMMING USING JAVA', 'DATA STRUCTURE AND ALGORITHMS', 'SOFTWARE ENGINEERING', 'WEB APPLICATION DEVELOPMENT', 'OBJECT ORIENTED PROGRAMMING USING JAVA LABORATORY', 'DATA STRUCTURE AND ALGORITHMS LABORATORY'];
      locals.subjects = names.map((subject_name, index) => ({ ...fixture.base.subjects[0], subject_id: index + 1, subject_code: index ? 'MMC20' + index : 'MAEC258', subject_name, max_internal: index ? 50 : 100, max_external: index ? 50 : 0, internalMarks: index ? 40 : 98, externalMarks: index ? 40 : 0 }));
    }

    if (['revaluation-review', 'locked'].includes(req.params.page) && req.query.rows === '8') {
      locals.rows = Array.from({ length: 8 }, (_, i) => ({
        ...fixture.base.rows[0], srid: i + 1, code: 'MMC20' + (i + 1),
        maxInternal: i ? 50 : 100, maxExternal: i ? 50 : 0, pickOptions: [],
        evidence: { ...fixture.base.rows[0].evidence, revised_int: i ? 40 : 100, revised_ext: i ? 40 : 0 }
      }));
    }
    if (req.query.document === '1' && req.params.page === 'revaluation-review') {
      const files = await fs.readdir(path.join(__dirname, '../uploads/revaluation')).catch(() => []);
      const pdf = files.find(file => file.endsWith('.pdf'));
      if (pdf) locals.meta = { ...locals.meta, docUrl: '/uploads/revaluation/' + encodeURIComponent(pdf), docName: pdf };
    }
    return res.render(page[0], locals);
  });

  // Isolated form targets for this mode never reach production revaluation routes.
  if (process.env.REVALUATION_PREVIEW_ONLY === '1') {
    app.post('/revaluation/review/9000', (req,res) => {
      verificationWrites.push({path:req.path,body:req.body});
      res.redirect('/verification/result-management/locked');
    });
    app.post('/revaluation/approve/9000', (req,res) => {
      verificationWrites.push({path:req.path,body:req.body});
      res.redirect('/verification/result-management/outcome');
    });
  }
  app.get('/verification/exam-sessions', (req, res) => res.render('exam-sessions/index', {
    title: 'Session defaults verification', pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/exam-sessions.css'], sessions: [editSessionFixture],
    batches: [{ batch_id: 9003, batch_name: 'Old Batch', start_year: 2020, end_year: 2022 }, { batch_id: 9001, batch_name: 'MCA Test', start_year: 2025, end_year: 2027 }, { batch_id: 9002, batch_name: 'BTech Test', start_year: 2026, end_year: 2030 }]
  }));
  app.get('/verification/subjects', (req, res) => res.render('subjects/index', { title: 'Subject edit verification', canManageRoster: true, pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/subjects.css'] }));
  app.get('/verification/roster', (req, res) => res.render('subjects/courses', {
    title: 'Semester Roster verification', pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/subjects.css'], canManageRoster: true,
    batches: [{ batch_id: 9001, batch_name: 'MCA', start_year: 2025, end_year: 2027 }, { batch_id: 9002, batch_name: 'BTech', start_year: 2026, end_year: 2030 }],
    selected: { batch_id: 9002, semester: '1' }, semesterLimit: 8, saved: req.query.saved === '1', editingRoster: req.query.verified !== '1' || req.query.edit === '1',
    courses: rosterFixtureCourses.map(course => ({ ...course, roster_verified: req.query.verified === '1' }))
  }));
  app.get('/verification/faculty', (req, res) => res.render('faculty/index', { title: 'Faculty count verification', pageStyles: ['/css/dashboard.css', '/css/batches.css', '/css/faculty.css'] }));
  app.get('/verification/cgpa-preview', (req, res) => {
    const subject = { subject_id: 1, course_id: 1, subject_code: 'MMC101', subject_name: 'Test Course', credits: 4,
      internalMarks: 40, externalMarks: 40, totalMarks: 80, percent: 80, grade: 'A+', grade_point: 9,
      grading_scheme_version: require('../services/academicPolicy').SCHEME, result_status: 'pass' };
    if (req.query.zero === '1') Object.assign(subject, { internalMarks: 0, externalMarks: 0, totalMarks: 0, percent: 0, grade: 'F', grade_point: 0, result_status: 'fail' });
    const attempt = { attempt_no: 1, exam_type: 'REGULAR' };
    const history = { results: [], subjects: [], courses: [{ course_id: 1, semester: '1', subject_code: 'MMC101', credits: 4, status: 'active', is_required: true, roster_verified: req.query.missing !== '1' }] };
    const cgpa = require('../services/academicOutcomeService').previewCumulative(history, 1, { exam_session_id: 1, semester: '1', exam_session: 'Jun', exam_year: 2026 }, attempt, [subject]);
    res.render('results/preview', { title: 'Validated Preview', importId: 9000, sessionDisplay: 'MCA 2025 - June 2026 - Semester 1', attempt, warnings: [], fileUrl: '', fileType: 'pdf',
      data: { student: { usn: 'TEST001', name: 'TEST STUDENT' }, subjects: [subject], overallResult: subject.result_status, sgpa: subject.grade_point, cgpa, failedSubjectCount: subject.result_status === 'fail' ? 1 : 0 } });
  });
  app.get('/verification/import-success', (req, res) => res.render('results/success', {
    title: 'Import Successful', pageStyles: ['/css/result-success.css'], savedConfirmed: true,
    studentName: 'RAVI RAUSHAN KUMAR', usn: '1MV25MC061', sessionDisplay: 'MCA 2025 - June 2026 - Semester 1',
    attemptNo: 1, examType: 'REGULAR', subjectsCount: 6, overallResult: 'pass', sgpa: 8.25, cgpa: req.query.missing === '1' ? null : 8.25
  }));
  app.get('/verification/revaluation-success', (req, res) => res.render('revaluation/outcome', {
    title: 'Revaluation Outcome', pageStyles: ['/css/result-success.css'], logStatus: req.query.status || 'success',
    meta: { importId: 1, resultId: 2, studentName: 'TEST STUDENT', studentUsn: 'TEST001', sessionDisplay: 'June 2026', attemptNo: 1, examType: 'REGULAR', docUrl: null, examSessionId: 1 },
    rows: [], aggregates: { overall_result: 'pass', sgpa: 7, cgpa: 7, failed_subject_count: 0 },
    origResult: { sgpa: 4, cgpa: 4, result_status: 'fail', failed_subject_count: 1 }, reviewedAt: null, reviewPresent: true, notice: null, error: null,
    events: [{ id: 1, srid: 2, no: 1, originalMarks: 40, revisedMarks: 60, originalStatus: 'fail', revisedStatus: 'pass', revisedGrade: 'B', isEffective: true, remarks: '' }]
  }));
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
    if (process.env.PROGRESS_CARDS_ONLY === '1') {
      await command('Page.navigate', { url: `${base}/analytics/progress` });
      await until("document.readyState==='complete' && document.getElementById('progress-filters')?.getAttribute('aria-busy')==='false'");
      const metrics = await evaluate("[...document.querySelectorAll('.progress-summary-grid .analytics-summary-value')].map(e=>e.textContent)");
      assert.equal(metrics.length, 6);
      assert.equal(await evaluate("document.querySelectorAll('.progress-summary-grid .stat-icon .material-icons[aria-hidden=true]').length"), 6);
      for (const width of [1920,1440,1280,1200,1024,768,390,360]) for (const theme of ['light','dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await evaluate(`window.setThemePreference(${JSON.stringify(theme)});document.querySelector('.progress-summary-grid').scrollIntoView({block:'center',behavior:'instant'})`);
        await pause(400);
        const layout = await evaluate(`(() => {
          const grid=document.querySelector('.progress-summary-grid');
          return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,document:document.documentElement.scrollWidth,
            rightGap:grid.getBoundingClientRect().right-grid.children[Math.min(grid.children.length, getComputedStyle(grid).gridTemplateColumns.split(' ').length)-1].getBoundingClientRect().right,
            cards:[...grid.children].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,
              fits:[...e.querySelectorAll('.card-body,.stat-content,.analytics-summary-label,.analytics-summary-value,.stat-icon')].every(c=>c.scrollWidth<=c.clientWidth+1 && c.scrollHeight<=c.clientHeight+1)})),
            metrics:[...grid.querySelectorAll('.analytics-summary-value')].map(e=>e.textContent)};
        })()`);
        assert.equal(layout.columns, width>=1200 ? 6 : width<768 ? 2 : 3);
        assert.ok(layout.document<=width+1);
        assert.ok(Math.abs(layout.rightGap)<2, `${width}: cards fill available width`);
        assert.ok(layout.cards.every(c=>c.height>=80 && c.height<=110 && c.fits), `${width} ${theme}: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.metrics, metrics);
        await fs.writeFile(path.join(output, `progress-compact-cards-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      assert.deepEqual(exceptions, []);
      console.log(`Compact full-width progress cards: sixteen viewport/theme checks passed, all six metrics unchanged. Screenshots: ${output}`);
      return;
    }
    if (process.env.ANALYTICS_STYLES_ONLY === '1') {
      let checks = 0;
      for (const page of ['overview','students','toppers','failed','subjects','semesters','progress','revaluation']) {
        await command('Page.navigate', { url: `${base}/analytics/${page}` });
        await until("document.readyState==='complete' && !!document.querySelector('.analytics-page') && typeof window.setThemePreference==='function'");
        await until(page === 'progress' ? "document.getElementById('progress-filters').getAttribute('aria-busy')==='false'" : page === 'overview' ? "document.querySelector('[data-metric=students] .stat-value').textContent !== '\u2014'" : `!!document.querySelector('#${page}-table-body tr') && !/Select filters|Loading/.test(document.getElementById('${page}-table-body').textContent)`);
        if (['overview','subjects','semesters','progress'].includes(page)) await until(`document.querySelectorAll('.analytics-page canvas').length >= ${page === 'subjects' ? 3 : 2}`);
        assert.equal(await evaluate("[...document.styleSheets].some(s=>s.href?.includes('/css/analytics.css') && s.cssRules.length>0)"), true, page + ': stylesheet loaded');
        for (const [width, height, theme] of [[1440,1000,'light'],[1440,1000,'dark'],[1024,900,'light'],[768,900,'light'],[390,844,'light'],[360,740,'dark']]) {
          await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          await evaluate(`window.setThemePreference(${JSON.stringify(theme)});window.scrollTo(0,0)`);
          await pause(450);
          const layout = await evaluate(`(() => {const root=document.querySelector('.analytics-page');return {
            document:document.documentElement.scrollWidth,
            titleSize:parseFloat(getComputedStyle(root.querySelector('h1')).fontSize),
            controls:[...root.querySelectorAll('input,select,button,a.btn')].filter(e=>{const r=e.getBoundingClientRect();return r.width && !e.closest('.table-responsive') && (r.left<0 || r.right>innerWidth+1)}).map(e=>e.id||e.className),
            charts:[...root.querySelectorAll('canvas')].filter(c=>c.getBoundingClientRect().width).map(c=>({width:c.width,height:c.height,painted:c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)}))};})()`);
          assert.ok(layout.document<=width+1, `${page} ${width}: document overflow ${JSON.stringify(layout)}`);
          assert.ok(layout.titleSize<=24, `${page}: title styling applied`);
          assert.deepEqual(layout.controls, [], `${page} ${width}: controls fit`);
          assert.ok(layout.charts.every(c=>c.width>0 && c.height>=240 && c.height<=700 && c.painted), `${page} ${width}: charts framed ${JSON.stringify(layout.charts)}`);
          if (page === 'overview') {
            assert.equal(await evaluate("[...document.querySelectorAll('.analytics-deep-link,.analytics-nav-link')].every(a=>getComputedStyle(a).textDecorationLine==='none')"), true);
          }
          if (width>=768) assert.equal(await evaluate("Math.abs(document.querySelector('.main-content').getBoundingClientRect().left-document.getElementById('sidebar').getBoundingClientRect().right)<2"), true, page + ': sidebar spacing');
          await fs.writeFile(path.join(output, `analytics-${page}-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
          if (width===390) {
            await evaluate("document.querySelector('.analytics-page canvas')?.scrollIntoView({block:'center',behavior:'instant'})");
            await pause(100);
            await fs.writeFile(path.join(output, `analytics-${page}-charts-mobile.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
          }
          checks++;
        }
      }
      assert.deepEqual(exceptions, []);
      console.log(`Verified Analytics stylesheet assets, controls, chart pixels, links and sidebar spacing across ${checks} page/theme/viewport checks. Screenshots: ${output}`);
      return;
    }
    if (process.env.DASHBOARD_INTERACTIVE_ONLY === '1') {
      await command('Page.navigate', { url: `${base}/verification/workspace/dashboard` });
      await until("document.readyState==='complete' && document.querySelector('.dashboard-page').getAttribute('aria-busy')==='false' && !!Chart.getChart('gradeDistributionChart')");
      assert.equal(await evaluate("Chart.getChart('passFailPieChart').config.type"), 'pie');
      assert.equal(await evaluate("!!document.getElementById('semesterPerformanceChart') || !!document.getElementById('passFailDoughnutChart')"), false);
      assert.equal(await evaluate("Chart.getChart('gradeDistributionChart').data.labels.length"), 7);
      assert.equal(await evaluate("document.querySelectorAll('#dashboardAttentionBody tr').length"), 5);
      assert.ok((await evaluate("document.querySelector('#topScorersTable tbody a').href")).includes('student_id=9400'));
      assert.ok((await evaluate("document.querySelector('#dashboardAttentionBody a').href")).includes('mode=original'));
      await evaluate("const order=document.getElementById('subjectChartOrder');order.value='code';order.dispatchEvent(new Event('change'))");
      assert.equal(await evaluate("Chart.getChart('subjectAverageChart').data.labels[0]"), 'MMC101');
      await evaluate("document.getElementById('subjectChartOrder').value='average';document.getElementById('subjectChartOrder').dispatchEvent(new Event('change'))");
      assert.equal(await evaluate("Chart.getChart('subjectAverageChart').data.labels[0]"), 'MMC112');
      await evaluate("document.getElementById('subjectAverageChart').scrollIntoView({block:'center'})");
      await pause(400);
      const hover = await evaluate("(() => {const c=Chart.getChart('subjectAverageChart'),r=c.canvas.getBoundingClientRect();return {x:r.left+c.getDatasetMeta(0).data[0].x,y:r.top+c.chartArea.top+5}})()");
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y });
      await until("Chart.getChart('subjectAverageChart').tooltip.opacity>0");
      const selectSemester = value => evaluate(`(() => {const s=document.getElementById('filterSemester');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change'));})()`);
      await selectSemester('1'); await selectSemester('2');
      await until("document.getElementById('totalStudents').textContent==='122' && document.querySelector('.dashboard-page').getAttribute('aria-busy')==='false'");
      await pause(500);
      assert.equal(await evaluate("document.getElementById('totalStudents').textContent"), '122');
      assert.ok((await evaluate("document.querySelector('[data-dashboard-link=\"/reports/class\"]').href")).includes('semester=2'));
      await selectSemester('3');
      await until("!document.getElementById('dashboardEmpty').classList.contains('d-none')");
      assert.equal(await evaluate("!!Chart.getChart('passFailPieChart') || !!Chart.getChart('gradeDistributionChart')"), false);
      assert.equal(await evaluate("document.getElementById('gradedAttemptCount').textContent"), '0');
      assert.equal(await evaluate("document.getElementById('averageCGPA').textContent"), '--');
      await selectSemester('4');
      await until("!document.getElementById('dashboardError').classList.contains('d-none')");
      assert.equal(await evaluate("document.getElementById('totalStudents').textContent"), '--');
      await evaluate("document.getElementById('resetFilterBtn').click()");
      await until("!!Chart.getChart('gradeDistributionChart') && document.querySelector('.dashboard-page').getAttribute('aria-busy')==='false'");
      await selectSemester('1');
      await evaluate("document.getElementById('filterBatch').value='9002';document.getElementById('filterBatch').dispatchEvent(new Event('change'))");
      await until("document.getElementById('filterSemester').options.length===2 && document.querySelector('.dashboard-page').getAttribute('aria-busy')==='false'");
      assert.equal(await evaluate("document.getElementById('filterSemester').value"), '');
      await evaluate("document.getElementById('resetFilterBtn').click()");
      await until("document.getElementById('totalStudents').textContent==='120' && !!Chart.getChart('gradeDistributionChart')");
      for (const [width, theme] of [[1440,'light'],[1024,'light'],[768,'light'],[390,'light'],[360,'dark']]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await evaluate(`window.setThemePreference(${JSON.stringify(theme)});window.scrollTo(0,0)`);
        await pause(500);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
        for (const id of ['subjectAverageChart','passFailPieChart','gradeDistributionChart']) {
          await evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
          await pause(350);
          assert.equal(await evaluate(`(() => {const c=document.getElementById(${JSON.stringify(id)}), p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return c.width>0 && c.height>0 && p.some((v,i)=>i%4===3 && v>0)})()`), true, id + ' painted');
          await fs.writeFile(path.join(output, `dashboard-${id}-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        }
      }
      await evaluate("document.getElementById('resetFilterBtn').click()");
      await until("!!Chart.getChart('gradeDistributionChart') && document.querySelector('.dashboard-page').getAttribute('aria-busy')==='false'");
      await selectSemester('2');
      await until("document.getElementById('filterSemester').value==='2' && document.getElementById('totalStudents').textContent==='122'");
      assert.equal(await evaluate("Chart.getChart('gradeDistributionChart').data.labels.length"), 7, 'Single semester retains all grade categories');
      await evaluate("document.querySelector('.dashboard-grade-details').open=true");
      assert.equal(await evaluate("document.querySelectorAll('#gradeBreakdownBody tr').length"), 7);
      assert.equal(await evaluate("[...document.querySelectorAll('#gradeBreakdownBody tr')].reduce((total,row)=>total+Number(row.cells[1].textContent),0)"), 120);
      await command('Page.navigate', { url: `${base}/dashboard` });
      await until("document.readyState==='complete' && !!document.querySelector('.dashboard-page') && document.querySelector('.dashboard-page').getAttribute('aria-busy')==='false'");
      assert.equal(await evaluate("document.getElementById('dashboardError').classList.contains('d-none')"), true, 'Real dashboard loads current database');
      const live = await evaluate("fetch('/dashboard/analytics?batch_id='+document.getElementById('filterBatch').value).then(r=>r.json())");
      assert.equal(await evaluate("document.getElementById('totalStudents').textContent"), String(live.data.statistics.totalStudents));
      await fs.writeFile(path.join(output, 'dashboard-real-data.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      assert.deepEqual(exceptions, []);
      console.log(`Dashboard pie, grade distribution, single-semester filters, grade breakdown, rapid changes, sorting, empty/error/recovery states, report links, responsive charts and dark mode passed. Screenshots: ${output}`);
      return;
    }
    if (process.env.SUBJECT_FORM_RESPONSIVE_ONLY === '1') {
      for (const [width, height] of [[390,844], [360,640], [320,568], [844,390], [390,420], [1440,1000]]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await command('Page.navigate', { url: `${base}/verification/workspace/subjects` });
        await until("document.readyState==='complete' && !!document.querySelector('#subjectSessionSelect option[value=\"9100\"]')");
        await evaluate("const select=document.getElementById('subjectSessionSelect');select.value='9100';select.dispatchEvent(new Event('change',{bubbles:true}))");
        await until("!!document.querySelector('#subjectsTableBody [data-edit-subject]')");
        await evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
        await evaluate("document.querySelector('#subjectsTableBody [data-edit-subject]').click()");
        await until("document.getElementById('subjectFormModal').classList.contains('show')");
        await pause(600);
        await evaluate("document.getElementById('subjectName').focus();const body=document.querySelector('#subjectFormModal .modal-body');body.scrollTop=body.scrollHeight");
        await pause(100);
        const visibility = await evaluate(`(() => {
          const button=document.getElementById('subjectSaveBtn'), rect=button.getBoundingClientRect();
          const parents=[]; for(let el=button.parentElement;el;el=el.parentElement){const r=el.getBoundingClientRect(), s=getComputedStyle(el); if(['auto','hidden','scroll','clip'].includes(s.overflowY)) parents.push({tag:el.id||el.className,top:r.top,bottom:r.bottom,overflow:s.overflowY}); if(el.classList.contains('modal')) break;}
          const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
          return {button:rect.toJSON(),parents,visible:rect.top>=0 && rect.bottom<=innerHeight && parents.every(p=>rect.top>=p.top && rect.bottom<=p.bottom) && !!hit && (hit===button || button.contains(hit))};
        })()`);
        await fs.writeFile(path.join(output, `subject-edit-${width}-${height}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        assert.equal(visibility.visible, true, `${width}x${height}: ${JSON.stringify(visibility)}`);
        await evaluate("document.getElementById('subjectSaveBtn').click()");
        await until("document.getElementById('subjectConfirmModal').classList.contains('show')");
      }
      assert.deepEqual(exceptions, []);
      console.log(`Edit Subject actions visible and Review opens confirmation at all six viewport sizes. Screenshots: ${output}`);
      return;
    }
    if (process.env.WORKSPACE_RESPONSIVE_ONLY === '1') {
      const pages = Object.keys(require('./fixtures/workspace-pages').pages);
      let pageChecks = 0, modalChecks = 0;
      const assertBounds = async label => {
        const bounds = await evaluate(`(() => {
          const root = document.querySelector('.workspace-page');
          return { width: innerWidth, document: document.documentElement.scrollWidth,
            root: root.getBoundingClientRect().toJSON(),
            overflowing: [...root.querySelectorAll('input,select,button,a.btn')].filter(e => {
              const r=e.getBoundingClientRect();
              return r.width && !e.closest('.table-responsive,.modal:not(.show)') && (r.right>innerWidth+2 || r.left < -2);
            }).map(e=>e.id || e.className) };
        })()`);
        assert.ok(bounds.document <= bounds.width + 2, `${label}: page overflow ${JSON.stringify(bounds)}`);
        assert.ok(bounds.root.width > bounds.width * (bounds.width < 768 ? .8 : .35), `${label}: content width`);
        assert.deepEqual(bounds.overflowing, [], `${label}: controls fit viewport`);
      };
      for (const page of pages) {
        for (const [width, height, theme] of [[1440, 1000, 'light'], [1024, 900, 'light'], [768, 900, 'light'], [390, 844, 'light'], [360, 740, 'dark'], [844, 390, 'light']]) {
          await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          await command('Page.navigate', { url: `${base}/verification/workspace/${page}` });
          await until("document.readyState==='complete' && !!document.querySelector('.workspace-page') && typeof window.setThemePreference==='function'");
          await evaluate(`window.setThemePreference(${JSON.stringify(theme)})`);
          await pause(400);
          if (page === 'dashboard') {
            await until("typeof Chart !== 'undefined' && !!Chart.getChart('passFailPieChart')");
            const charts = await evaluate(`['subjectAverageChart','gradeDistributionChart','passFailPieChart'].map(id=>{
              const c=document.getElementById(id), pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
              return { id, width:c.width, height:c.height, painted:pixels.some((v,i)=>i%4===3 && v>0) };
            })`);
            assert.ok(charts.every(c=>c.width>0 && c.height>0 && c.painted), `${page}: charts render ${JSON.stringify(charts)}`);
          }
          if (page === 'faculty' || page === 'subjects') {
            const selectId = page === 'faculty' ? 'facultySessionSelect' : 'subjectSessionSelect';
            await until(`!!document.querySelector('#${selectId} option[value="9100"]')`);
            await evaluate(`(() => { const select=document.getElementById('${selectId}'); select.value='9100'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
            await until(page === 'faculty' ? "!document.getElementById('facultyDashboard').classList.contains('d-none') && !!document.querySelector('#facultyTableBody tr')" : "!!document.querySelector('#subjectsTableBody tr')");
          }
          await assertBounds(`${page} ${width}x${height}`);
          if (width >= 768) {
            assert.equal(await evaluate("Math.abs(document.querySelector('.main-content').getBoundingClientRect().left - document.getElementById('sidebar').getBoundingClientRect().right) < 2"), true, `${page}: content follows sidebar`);
          }
          if (width >= 768 && width < 1024) {
            await evaluate("document.getElementById('sidebarCollapseBtn').click()");
            await pause(400);
            await assertBounds(`${page} ${width}: sidebar toggled`);
            const sidebarBounds = await evaluate("({main:document.querySelector('.main-content').getBoundingClientRect().left, sidebar:document.getElementById('sidebar').getBoundingClientRect().right, classes:document.getElementById('sidebar').className, matches:document.querySelector('.main-content').matches('.sidebar.collapsed ~ .main-content:has(.workspace-page)')})");
            assert.ok(Math.abs(sidebarBounds.main - sidebarBounds.sidebar) < 2, `${page}: toggled sidebar aligns ${JSON.stringify(sidebarBounds)}`);
            await evaluate("document.getElementById('sidebarCollapseBtn').click()");
            await pause(400);
          }
          if ([1440,768,390,360].includes(width)) await fs.writeFile(path.join(output, `workspace-${page}-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
          if (page === 'dashboard' && [1440,390,360].includes(width)) {
            await evaluate("document.querySelector('.dashboard-chart-grid').scrollIntoView()");
            await pause(250);
            await fs.writeFile(path.join(output, `workspace-dashboard-charts-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
          }
          pageChecks++;
          if ([390,844].includes(width)) {
            const ids = await evaluate("[...document.querySelectorAll('.workspace-page .modal')].map(e=>e.id)");
            for (const id of ids) {
              await evaluate(`new Promise(resolve => { const modal=document.getElementById(${JSON.stringify(id)});
                modal.addEventListener('shown.bs.modal',()=>resolve(true),{once:true}); bootstrap.Modal.getOrCreateInstance(modal).show(); })`);
              const bounds = await evaluate(`(() => { const modal=document.getElementById(${JSON.stringify(id)}); const c=modal.querySelector('.modal-content').getBoundingClientRect();
                const footer=modal.querySelector('.modal-footer').getBoundingClientRect(); return {left:c.left,right:c.right,top:c.top,bottom:c.bottom,footerBottom:footer.bottom}; })()`);
              assert.ok(bounds.left>=0 && bounds.right<=width+1 && bounds.top>=0 && bounds.bottom<=height+1 && bounds.footerBottom<=height+1, `${page} ${id} ${width}x${height}: ${JSON.stringify(bounds)}`);
              await assertBounds(`${page} ${id} ${width}x${height}`);
              if (width===390) await fs.writeFile(path.join(output, `workspace-${page}-${id}-mobile.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
              await evaluate(`new Promise(resolve => { const modal=document.getElementById(${JSON.stringify(id)});
                modal.addEventListener('hidden.bs.modal',()=>resolve(true),{once:true}); bootstrap.Modal.getInstance(modal).hide(); })`);
              modalChecks++;
            }
          }
        }
      }
      assert.deepEqual(exceptions, []);
      console.log(`Verified ${pageChecks} workspace viewport checks and ${modalChecks} modal checks. Screenshots: ${output}`);
      return;
    }
    if (process.env.RESULT_REVIEW_LAYOUT_ONLY === '1') {
      let checked = 0;
      for (const [width,height] of [[1920,1080],[1440,900],[1280,800],[1024,900],[768,900],[390,844],[360,740]]) for (const theme of ['light','dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await command('Page.navigate', { url: base + '/verification/result-management/review?rows=8' });
        await until("document.readyState==='complete' && !!document.querySelector('.result-review-layout')");
        await evaluate('window.setThemePreference(' + JSON.stringify(theme) + ')');
        await pause(350);
        const layout = await evaluate("(() => {const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();const wrap=document.querySelector('.result-review-table-scroll');return {document:document.documentElement.scrollWidth,grid:box('.result-review-layout'),frame:box('.result-document-frame'),source:box('.result-review-document'),subjects:box('.result-review-subjects'),actions:box('.result-review-actions'),tableScroll:wrap.scrollWidth>wrap.clientWidth+1,rows:document.querySelectorAll('#subjectsTable tbody tr').length,columns:document.querySelectorAll('#subjectsTable th').length,inputs:document.querySelectorAll('#subjectsTable input').length,externalZero:document.getElementById('external_1').getAttribute('max')};})()");
        assert.ok(layout.document <= width + 1, JSON.stringify(layout));
        assert.equal(layout.rows, 8); assert.equal(layout.columns, 6); assert.equal(layout.inputs, 16); assert.equal(layout.externalZero, '0');
        assert.ok(layout.frame.width > 250 && layout.frame.height >= 220, JSON.stringify(layout));
        if (width >= 1200) {
          assert.ok(Math.abs(layout.source.bottom-layout.subjects.bottom)<2, 'Document bottom matches Subject Results: '+JSON.stringify(layout));
          assert.ok(Math.abs(layout.source.width-layout.subjects.width)<2, 'Original equal-width columns retained');
          assert.ok(layout.actions.top>=layout.subjects.bottom, 'Actions stay below both comparison panels');
          assert.ok(await evaluate("(() => {const body=document.querySelector('#subjectsTable tbody'),row=body.firstElementChild.cloneNode(true);body.appendChild(row);const left=document.querySelector('.result-review-document').getBoundingClientRect(),right=document.querySelector('.result-review-subjects').getBoundingClientRect();const matches=Math.abs(left.bottom-right.bottom)<2;row.remove();return matches;})()"), 'Document follows dynamically growing subject content');
        } else {
          assert.ok(layout.subjects.top>layout.source.bottom, 'Source and marks stack on narrow screens');
        }
        await evaluate("document.querySelector('.result-review-actions').scrollIntoView({block:'end',behavior:'instant'})");
        const action=await evaluate("document.getElementById('validateButton').getBoundingClientRect().toJSON()");
        assert.ok(action.left>=0 && action.right<=width && action.bottom<=height+1, JSON.stringify(action));
        await fs.writeFile(path.join(output,'review-actions-'+width+'-'+theme+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate('window.scrollTo(0,0)');
        await evaluate("document.getElementById('internal_2').value='30';document.getElementById('internal_2').dispatchEvent(new Event('input',{bubbles:true}))");
        assert.equal(await evaluate("document.getElementById('internal_2').closest('tr').querySelector('.total-cell').textContent"),'70');
        await fs.writeFile(path.join(output,'review-layout-'+width+'-'+theme+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
        checked++;
      }
      assert.deepEqual(exceptions,[]);
      if (process.env.RESULT_REVIEW_IMPORT_ID) {
        const id=Number(process.env.RESULT_REVIEW_IMPORT_ID);
        assert.ok(Number.isSafeInteger(id) && id>0);
        await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await command('Page.navigate',{url:base+'/results/upload/'+id+'/review'});
        await until("document.readyState==='complete' && !!document.querySelector('.result-review-layout')");
        await evaluate("window.setThemePreference('light')");
        const asset=await evaluate("document.querySelector('.result-document-frame').getAttribute('src')");
        const response=await fetch(base+asset);
        assert.ok(response.ok,'Original document is accessible');
        assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
        await pause(1000);
        await fs.writeFile(path.join(output,'review-real-document.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
        assert.ok(await evaluate("Math.abs(document.querySelector('.result-review-document').getBoundingClientRect().bottom-document.querySelector('.result-review-subjects').getBoundingClientRect().bottom)<2"), 'Actual document height matches Subject Results');
        await evaluate("document.querySelector('.result-review-actions').scrollIntoView({block:'end',behavior:'instant'})");
        await fs.writeFile(path.join(output,'review-real-document-bottom.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
        console.log('Actual Review page and source PDF verified read-only for import '+id);
      }
      console.log('Review layout: '+checked+' desktop/mobile/theme checks passed. Screenshots: '+output);
      return;
    }



    if (process.env.RESULT_IDENTITY_ONLY === '1') {
      let checked=0;
      for (const width of [1440,390]) for (const theme of ['light','dark']) {
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await command('Page.navigate',{url:base+'/verification/result-management/review?identity=mismatch'});
        await until('document.readyState==="complete" && !!document.getElementById("resultValidationAlert")');
        await evaluate('document.documentElement.setAttribute("data-theme",'+JSON.stringify(theme)+')');
        assert.equal(await evaluate('document.getElementById("studentNameInput").value'),'AMRUTHA SLOP');
        assert.equal(await evaluate('document.getElementById("studentNameInput").classList.contains("is-invalid")'),true);
        assert.equal(await evaluate('document.getElementById("studentNameInput").getAttribute("aria-invalid")'),'true');
        assert.equal(await evaluate('document.getElementById("validateButton").disabled'),false);
        assert.ok(await evaluate('document.getElementById("resultValidationAlert").textContent.includes("Registered name: AMRUTHA S")'));
        assert.ok(await evaluate('document.documentElement.scrollWidth')<=width+2);
        await fs.writeFile(path.join(output,'result-name-mismatch-'+width+'-'+theme+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate(`document.getElementById("reviewForm").addEventListener("submit",e=>{window.blockedByClient=e.defaultPrevented;window.submittedName=document.getElementById("studentNameInput").value;e.preventDefault()});
          document.getElementById("studentNameInput").value="AMRUTHA S";
          document.getElementById("studentNameInput").dispatchEvent(new Event("input",{bubbles:true}));
          document.getElementById("validateButton").click();`);
        assert.equal(await evaluate('window.blockedByClient'),false);
        assert.equal(await evaluate('window.submittedName'),'AMRUTHA S');
        checked++;
      }
      assert.deepEqual(exceptions,[]);
      console.log('Verified '+checked+' name-mismatch desktop/mobile/theme cases: visible persisted error, editable name and correction/resubmission. No results submitted. Screenshots: '+output);
      return;
    }
    if (process.env.MARKS_CARD_IMAGES_ONLY === '1') {
      const capture=async name=>fs.writeFile(path.join(output,name+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
      let checked=0;
      for(const page of ['upload','revaluation-upload']) for(const width of [1440,390]) for(const theme of ['light','dark']){
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await command('Page.navigate',{url:base+'/verification/result-management/'+page});
        await until("document.readyState==='complete' && !!window.MarksCardValidation");
        await evaluate('document.documentElement.setAttribute("data-theme",'+JSON.stringify(theme)+')');
        const result=page==='upload';
        const inputId=result?'marksCardInput':'revalidationDocument';
        const buttonId=result?'extractButton':'submitUploadBtn';
        if(result){
          await evaluate('document.getElementById("examSessionSelect").value="9000";document.getElementById("examSessionSelect").dispatchEvent(new Event("change",{bubbles:true}))');
          await until('document.getElementById("displaySubjectCount").textContent==="1"');
        }
        const accept=await evaluate('document.getElementById('+JSON.stringify(inputId)+').accept');
        for(const extension of ['.pdf','.png','.jpg','.jpeg'])assert.ok(accept.includes(extension));
        async function choose(name,type,drop,large){
          await evaluate('('+ (async function(inputId,name,type,drop,large){
            const bytes=large?new Uint8Array(15*1024*1024+1):await(await fetch('/verification/marks-card.png')).arrayBuffer();
            const transfer=new DataTransfer();transfer.items.add(new File([bytes],name,{type}));
            const input=document.getElementById(inputId);
            if(drop)document.getElementById('dropZone').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
            else{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))}
          }).toString()+')('+[inputId,name,type,drop,large].map(v=>JSON.stringify(v)).join(',')+')');
        }
        // Browser validity popovers are not needed for assertions.
        await evaluate('document.querySelector("input[type=file]").reportValidity=()=>true');
        for(const [name,type] of [['card.PNG','image/png'],['card.jpg','image/jpeg'],['card.jpeg','image/jpeg']]){
          await choose(name,type,result,false);
          assert.equal(await evaluate('document.getElementById('+JSON.stringify(buttonId)+').disabled'),false,name);
          assert.equal(await evaluate('document.getElementById('+JSON.stringify(inputId)+').validationMessage'),'');
        }
        await choose('card.svg','image/svg+xml',result,false);
        assert.equal(await evaluate('document.getElementById('+JSON.stringify(buttonId)+').disabled'),true);
        await choose('large.png','image/png',result,true);
        assert.equal(await evaluate('document.getElementById('+JSON.stringify(buttonId)+').disabled'),true);
        await choose('card.png','image/png',result,false);
        await evaluate('document.getElementById('+JSON.stringify(buttonId)+').scrollIntoView({block:"center",behavior:"instant"})');
        await capture('image-upload-'+page+'-'+width+'-'+theme);
        assert.ok(await evaluate('document.documentElement.scrollWidth')<=width+2);
        await evaluate('window.testSubmissions=0;document.getElementById("uploadForm").addEventListener("submit",event=>{event.preventDefault();window.testSubmissions++});document.getElementById('+JSON.stringify(buttonId)+').click()');
        assert.equal(await evaluate('window.testSubmissions'),1);
        assert.equal(await evaluate('document.getElementById('+JSON.stringify(buttonId)+').disabled'),true);
        checked++;
      }
      for(const page of ['review','revaluation-review']) for(const width of [1440,390]) for(const theme of ['light','dark']){
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await command('Page.navigate',{url:base+'/verification/result-management/'+page+'?image=1'});
        await until('document.readyState==="complete" && !!document.querySelector("img[alt]") && document.querySelector("img[alt]").naturalWidth>0');
        await evaluate('document.documentElement.setAttribute("data-theme",'+JSON.stringify(theme)+');document.querySelector("img[alt]").scrollIntoView({block:"center",behavior:"instant"})');
        await pause(200);
        const image=await evaluate('document.querySelector(".revaluation-document-image,.result-review-document-image").getBoundingClientRect().toJSON()');
        assert.ok(image.width>200 && image.height>200);
        assert.ok(image.right<=width+2);
        assert.ok(await evaluate('document.documentElement.scrollWidth')<=width+2);
        await capture('image-preview-'+page+'-'+width+'-'+theme);
        checked++;
      }
      assert.deepEqual(exceptions,[]);
      console.log('Verified '+checked+' image-upload/preview viewport/theme cases: PNG/JPG/JPEG selection, result drag/drop, size/type rejection and processing locks. No academic data submitted. Screenshots: '+output);
      return;
    }
    if (process.env.REVALUATION_PREVIEW_ONLY === '1') {
      const screenshot = async name => fs.writeFile(path.join(output, name + '.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      for (const width of [1440, 1024, 768, 390, 360]) for (const theme of ['light', 'dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await command('Page.navigate', { url: base + '/verification/result-management/revaluation-review?rows=8&document=1' });
        await until("document.readyState==='complete' && !!document.getElementById('validateRevaluationBtn')");
        await evaluate('document.documentElement.setAttribute("data-theme",' + JSON.stringify(theme) + ')');
        await pause(400);
        const bounds = await evaluate(`(() => {
          const doc = document.querySelector('.revaluation-preview-document').getBoundingClientRect();
          const editor = document.getElementById('reviewForm').getBoundingClientRect();
          return { width: document.documentElement.scrollWidth, doc: doc.toJSON(), editor: editor.toJSON(),
            rows: document.querySelectorAll('#reviewTable tbody tr').length };
        })()`);
        assert.ok(bounds.width <= width + 2, 'Preview fits ' + width);
        assert.equal(bounds.rows, 8);
        if (width >= 1200) {
          assert.ok(Math.abs(bounds.doc.y - bounds.editor.y) <= 2);
          assert.ok(Math.abs(bounds.doc.right - bounds.editor.left) <= 20);
        } else assert.ok(bounds.editor.y >= bounds.doc.bottom, 'Panels stack on smaller screens');
        assert.equal(await evaluate('document.getElementById("ext_1").max'), '0');
        assert.equal(await evaluate('document.getElementById("tot_1").textContent'), '100');
        await evaluate('document.querySelector("label[for=reject_2]").click()');
        assert.equal(await evaluate('document.getElementById("int_2").disabled'), true);
        await evaluate('document.querySelector("label[for=accept_2]").click(); document.getElementById("ext_2").value="45"; document.getElementById("ext_2").dispatchEvent(new Event("input",{bubbles:true}))');
        assert.equal(await evaluate('document.getElementById("tot_2").textContent'), '85');
        if (width === 1440) {
          const doc = await evaluate('(async () => { const src=document.querySelector(".revaluation-document-frame").getAttribute("src"); if(src==="about:blank") return null; const r=await fetch(src); return {status:r.status, header:(await r.text()).slice(0,4)}; })()');
          if (doc) { assert.equal(doc.status,200); assert.equal(doc.header,'%PDF'); }
        }
        await evaluate('document.querySelectorAll(".table-responsive").forEach(e=>e.scrollLeft=0)');
        await screenshot('revaluation-preview-' + width + '-' + theme);
        await evaluate('document.getElementById("validateRevaluationBtn").scrollIntoView({block:"center",behavior:"instant"})');
        await pause(150);
        await screenshot('revaluation-preview-actions-' + width + '-' + theme);
      }

      await command('Page.navigate', { url: base + '/verification/result-management/revaluation-upload' });
      await until("document.readyState==='complete' && !!document.getElementById('uploadForm')");
      assert.equal(await evaluate('!!document.getElementById("submitConfirmModal")'),false);
      await evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['%PDF-1.4 test'], 'test.pdf', {type:'application/pdf'}));
        const input=document.getElementById('revalidationDocument');
        input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
        window.uploadRequests=0;
        document.getElementById('uploadForm').addEventListener('submit',e=>{e.preventDefault();window.uploadRequests++});
        document.getElementById('submitUploadBtn').click();
      })()`);
      assert.equal(await evaluate('window.uploadRequests'),1);
      assert.equal(await evaluate('document.getElementById("submitUploadBtn").disabled'),true);
      assert.equal(await evaluate('document.getElementById("uploadProgress").classList.contains("d-none")'),false);

      await command('Page.navigate',{url:base+'/verification/result-management/extraction'});
      await until("document.readyState==='complete' && !!document.getElementById('confirmMismatchModal')");
      assert.equal(await evaluate('document.getElementById("validateRevaluationBtn").disabled'),true);
      await evaluate('document.getElementById("confirmIdentityBtn").click()');
      await pause(400);
      await until('!!document.querySelector(".modal.show .modal-content")');
      const modal=await evaluate('document.querySelector(".modal.show .modal-content").getBoundingClientRect().toJSON()');
      assert.ok(modal.left>=0 && modal.right<=360 && modal.height<=900);
      await screenshot('revaluation-preview-identity-mobile');

      await command('Page.navigate',{url:base+'/verification/result-management/revaluation-review'});
      await until("document.readyState==='complete' && !!document.getElementById('validateRevaluationBtn')");
      await evaluate('document.getElementById("validateRevaluationBtn").click()');
      await until('location.pathname.endsWith("/locked")');
      assert.equal(verificationWrites.length,1);
      assert.equal(verificationWrites[0].body.decision_1,'accept');
      assert.equal(verificationWrites[0].body.internal_1,'40');
      assert.equal(await evaluate('document.querySelectorAll("#approveRevaluationForm").length'),1);
      assert.equal(await evaluate('[...document.querySelectorAll("a")].filter(a=>a.getAttribute("href")==="/revaluation/approve/9000").length'),0);
      await evaluate('document.querySelector("#approveRevaluationForm button").click()');
      await until('location.pathname.endsWith("/outcome")');
      assert.equal(verificationWrites.length,2);
      assert.deepEqual(exceptions,[]);
      console.log('Revaluation: 10 viewport/theme checks, real PDF read, mark editing, upload progress, identity modal, Validate and explicit approval passed. Screenshots: '+output);
      return;
    }
    if (process.env.RESULT_MANAGEMENT_RESPONSIVE_ONLY === '1') {
      const pages = Object.keys(require('./fixtures/result-management-pages').pages);
      let checked = 0;
      for (const page of pages) {
        for (const [width, theme] of [[1440, 'light'], [1024, 'light'], [768, 'light'], [390, 'light'], [360, 'light'], [390, 'dark']]) {
          await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          await command('Page.navigate', { url: `${base}/verification/result-management/${page}` });
          await until("document.readyState==='complete'");
          assert.equal(await evaluate("!!document.querySelector('.result-management-page,.revaluation-ui')"), true, `${page} rendered`);
          await pause(350);
          await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
          await pause(300);
          const bounds = await evaluate(`(() => {
            const root = document.querySelector('.result-management-page,.revaluation-ui');
            return { viewport: innerWidth, document: document.documentElement.scrollWidth,
              root: root.getBoundingClientRect().toJSON(),
              overflowing: [...root.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 2 && !e.closest('.table-responsive')).slice(0, 8).map(e => e.tagName + '.' + e.className) };
          })()`);
          assert.ok(bounds.document <= width + 2, `${page} ${width}: ${JSON.stringify(bounds)}`);
          assert.deepEqual(bounds.overflowing, [], `${page} ${width}: controls stay within viewport`);
          assert.ok(bounds.root.width > width * (width < 768 ? .8 : .35), `${page} usable content width`);
          await evaluate("document.querySelectorAll('.table-responsive').forEach(e => e.scrollLeft = e.scrollWidth)");
          if (page === 'blocked') assert.equal(await evaluate("document.querySelector('#reviewForm button[type=submit]').disabled"), true);
          if (page === 'extraction' && width === 360) {
            await evaluate("bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmMismatchModal')).show()");
            await pause(400);
            const modal = await evaluate("document.querySelector('.modal.show .modal-content').getBoundingClientRect().toJSON()");
            assert.ok(modal.x >= 0 && modal.right <= width && modal.height <= 900, 'Mismatch modal fits phone');
            await command('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFile(path.join(output, 'result-mismatch-modal-mobile.png'), Buffer.from(s.data, 'base64')));
          }
          if ([1440, 390].includes(width)) {
            await fs.writeFile(path.join(output, `result-${page}-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            if (width === 390 && ['confirm', 'preview', 'revaluation-upload'].includes(page)) {
              await evaluate('window.scrollTo(0, document.body.scrollHeight)');
              await pause(100);
              await fs.writeFile(path.join(output, `result-${page}-actions-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            }
          }
          checked++;
        }
      }
      assert.deepEqual(exceptions, []);
      console.log(`Verified ${checked} responsive Result Management screens. Screenshots: ${output}`);
      return;
    }
    if (process.env.CGPA_PREVIEW_ONLY === '1') {
      for (const [query, expected] of [['', '9.00'], ['?missing=1', 'Unavailable'], ['?zero=1', '0.00']]) {
        await command('Page.navigate', { url: `${base}/verification/cgpa-preview${query}` });
        await until("document.readyState==='complete' && !!document.getElementById('previewCumulativeCgpa')");
        assert.equal(await evaluate("document.getElementById('previewCumulativeCgpa').textContent"), expected);
        if (!query) await fs.writeFile(path.join(output, 'validated-preview-cgpa.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      assert.deepEqual(exceptions, []);
      console.log('Validated Preview: calculated CGPA, incomplete history and zero GPA render correctly; no result saved');
      console.log(`Screenshot: ${output}`); return;
    }
    if (process.env.COMPACT_ALL_REPORTS_PDF_ONLY === '1') {
      const [scopes] = await sequelize.query(`SELECT st.student_id,st.batch_id,r.exam_session_id,rs.semester,MIN(sr.subject_id) subject_id
        FROM students st JOIN results r ON r.student_id=st.student_id
        JOIN exam_sessions rs ON rs.exam_session_id=r.exam_session_id JOIN subject_results sr ON sr.result_id=r.result_id
        WHERE st.deleted_at IS NULL GROUP BY st.student_id,st.batch_id,r.exam_session_id,rs.semester ORDER BY st.student_id LIMIT 1`);
      assert.ok(scopes.length, 'All-report print verification requires a saved result');
      const scope = scopes[0];
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { createCanvas } = require('@napi-rs/canvas');
      for (const type of ['student', 'class', 'subject', 'revaluation', 'toppers', 'consolidated', 'result-analysis', 'student-progress']) {
        const query = { batch_id: scope.batch_id, mode: type === 'toppers' ? 'original' : 'effective' };
        if (type === 'student') query.student_id = scope.student_id;
        else if (type !== 'student-progress') { query.exam_session_id = scope.exam_session_id; query.semester = scope.semester; }
        if (type === 'subject') query.subject_id = scope.subject_id;
        const report = await service.getReport(type, query);
        await command('Emulation.setDeviceMetricsOverride', { width: type === 'student-progress' ? 1588 : 1123, height: type === 'student-progress' ? 1123 : 794, deviceScaleFactor: 1, mobile: false });
        await command('Emulation.setEmulatedMedia', { media: 'print' });
        await command('Page.navigate', { url: `${base}/reports/${type}/print?${new URLSearchParams(query)}` });
        await until("document.readyState==='complete' && document.body.classList.contains('reports-print') && [...document.images].every(image=>image.complete)");
        if (type === 'result-analysis') await until('window.reportChartReady===true');
        const tableTop = await evaluate("document.querySelector('.reports-table')?.getBoundingClientRect().top ?? null");
        if (tableTop !== null) assert.ok(tableTop < 310, `${type}: first table must start within 310px, got ${tableTop}`);
        const bytes = Buffer.from((await command('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
        await fs.writeFile(path.join(output, `${type}-compact.pdf`), bytes);
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
        const pdf = await task.promise;
        let text = '';
        for (let n = 1; n <= pdf.numPages; n++) text += (await (await pdf.getPage(n)).getTextContent()).items.map(item => item.str).join(' ') + '\n';
        assert.ok(text.includes('MCA'), `${type}: branding/context retained in PDF`);
        if (type === 'student-progress') {
          assert.ok(text.includes('Missing or unverified semesters'), 'Progress explanatory notes retained after table');
          assert.equal(await evaluate("document.querySelector('.reports-progress').compareDocumentPosition(document.querySelector('.reports-progress-notes')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4);
        }
        const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1.25 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        await fs.writeFile(path.join(output, `${type}-compact.png`), canvas.toBuffer('image/png'));
        console.log(`${type}: first table at ${tableTop === null ? 'empty report' : Math.round(tableTop) + 'px'}, ${pdf.numPages} PDF page(s), ${report.pagination?.totalRows ?? report.rows.length} records`);
        await task.destroy();
      }
      assert.deepEqual(exceptions, []);
      console.log(`All eight report PDFs and rendered previews: ${output}`); return;
    }
    if (process.env.COMPACT_STUDENT_PDF_ONLY === '1') {
      const [students] = await sequelize.query(`SELECT st.student_id,st.batch_id,COUNT(*) subject_count FROM students st
        JOIN results r ON r.student_id=st.student_id JOIN subject_results sr ON sr.result_id=r.result_id
        WHERE st.deleted_at IS NULL GROUP BY st.student_id,st.batch_id
        HAVING COUNT(DISTINCT r.result_id)=1 AND COUNT(*) BETWEEN 1 AND 12 ORDER BY st.student_id LIMIT 1`);
      assert.ok(students.length, 'Compact PDF verification requires one student with a single saved attempt');
      const query = { batch_id: students[0].batch_id, student_id: students[0].student_id, mode: 'effective' };
      const report = await service.getReport('student', query);
      await command('Emulation.setDeviceMetricsOverride', { width: 1123, height: 794, deviceScaleFactor: 1, mobile: false });
      await command('Emulation.setEmulatedMedia', { media: 'print' });
      await command('Page.navigate', { url: `${base}/reports/student/print?${new URLSearchParams(query)}` });
      await until("document.readyState==='complete' && !!document.querySelector('.reports-student-attempt .reports-table') && [...document.images].every(image=>image.complete)");
      const tableTop = await evaluate("document.querySelector('.reports-student-attempt .reports-table').getBoundingClientRect().top");
      assert.ok(tableTop < 300, `Student table must start within the first 300px, got ${tableTop}`);
      assert.equal(await evaluate("document.querySelectorAll('.reports-student-attempt tbody tr').length"), report.rows.length);
      const pdfResult = await command('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
      const bytes = Buffer.from(pdfResult.data, 'base64');
      await fs.writeFile(path.join(output, 'student-report-compact.pdf'), bytes);
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const pdf = await loadingTask.promise;
      assert.equal(pdf.numPages, 1, 'A normal single-attempt report must fit on one page');
      const page = await pdf.getPage(1);
      const text = (await page.getTextContent()).items.map(item => item.str).join(' ');
      for (const row of report.rows) assert.ok(text.includes(row.subject_code), `PDF must retain ${row.subject_code}`);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = require('@napi-rs/canvas').createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      await fs.writeFile(path.join(output, 'student-report-compact.png'), canvas.toBuffer('image/png'));
      console.log(`Compact PDF: table starts at ${Math.round(tableTop)}px; ${report.rows.length} subjects preserved on ${pdf.numPages} page; rendered PDF verified`);
      console.log(`PDF and preview: ${output}`); await loadingTask.destroy(); return;
    }
    if (process.env.PROGRESS_BASIS_ONLY === '1') {
      const progress = require('../services/progressAnalyticsService');
      const batches = await service.getOptions('batches', {});
      assert.ok(batches.length, 'Progress verification requires an existing batch');
      const batchId = batches[0].batch_id;
      const effective = await progress.getProgress({ batch_id: batchId });
      const original = await progress.getProgress({ batch_id: batchId, semester: effective.filters.semester, mode: 'original' });
      const route = `${base}/analytics/progress?batch_id=${batchId}&semester=${effective.filters.semester}`;
      await command('Page.navigate', { url: route });
      await until("document.readyState==='complete' && document.getElementById('progress-filters')?.getAttribute('aria-busy')==='false' && !!document.getElementById('progress-scope').value");
      assert.equal(await evaluate("document.getElementById('progress-mode').value"), 'effective');
      assert.equal(await evaluate("document.getElementById('progress-clearance-heading').textContent"), 'Clearance Status (Effective)');
      assert.equal(await evaluate("document.getElementById('progress-uncleared').textContent"), String(effective.summary.uncleared));
      assert.deepEqual(await evaluate("[...document.querySelectorAll('#progress-attention-body a')].map(a=>Number(new URL(a.href).searchParams.get('student_id')))"), effective.attention.map(s => Number(s.studentId)));
      for (const width of [1440, 390]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await pause(350);
        await fs.writeFile(path.join(output, `progress-effective-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      await command('Page.navigate', { url: route + '&mode=original' });
      await until("document.getElementById('progress-clearance-heading')?.textContent==='Clearance Status (Original)' && document.getElementById('progress-filters').getAttribute('aria-busy')==='false'");
      assert.equal(await evaluate("document.getElementById('progress-uncleared').textContent"), String(original.summary.uncleared));
      await evaluate("document.getElementById('progress-filters').reset()");
      await until("document.getElementById('progress-mode').value==='effective' && document.getElementById('progress-clearance-heading').textContent==='Clearance Status (Effective)' && document.getElementById('progress-filters').getAttribute('aria-busy')==='false'");
      assert.equal(await evaluate("document.getElementById('progress-uncleared').textContent"), String(effective.summary.uncleared));
      assert.deepEqual(exceptions, []);
      console.log('Progress: Effective default, approved revaluation clearance, Original links, basis labels and Effective reset agree with read-only database results');
      console.log(`Screenshots: ${output}`); return;
    }
    if (process.env.STUDENT_FORM_ONLY === '1') {
      const batches = await service.getOptions('batches', {});
      assert.ok(batches.length, 'Student form verification requires an existing batch');
      await command('Page.navigate', { url: `${base}/students?batch_id=all` });
      await until("document.readyState==='complete' && !!document.getElementById('addStudentBtn')");
      await evaluate("document.getElementById('addStudentBtn').click()");
      await until("document.getElementById('studentFormModal').classList.contains('show')");
      assert.equal(await evaluate("document.getElementById('studentBatch').value"), String(batches[0].batch_id));
      assert.equal(await evaluate("document.getElementById('studentStatus').value"), 'active');
      await evaluate("document.getElementById('studentUsn').value='TEST001';document.getElementById('studentName').value='Test Student';document.getElementById('studentCategory').value='PGCET';document.getElementById('studentEmail').value='student@gmail.clh';document.getElementById('studentEmail').dispatchEvent(new Event('blur'));document.getElementById('studentFormNextBtn').click()");
      assert.equal(await evaluate("document.getElementById('studentEmail').classList.contains('is-invalid') && !document.getElementById('studentConfirmModal').classList.contains('show')"), true);
      for (const width of [1440, 390]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await pause(350);
        assert.equal(await evaluate("document.getElementById('studentFormModal').scrollWidth<=innerWidth+1"), true);
        await fs.writeFile(path.join(output, `student-form-email-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      await evaluate("document.getElementById('studentEmail').value='STUDENT.NAME@GMAIL.COM';document.getElementById('studentEmail').dispatchEvent(new Event('input'));document.getElementById('studentFormNextBtn').click()");
      await until("document.getElementById('studentConfirmModal').classList.contains('show')");
      assert.equal(await evaluate("document.getElementById('studentConfirmDetails').textContent.includes('student.name@gmail.com')"), true);
      assert.deepEqual(exceptions, []);
      console.log('Add Student: newest batch, Active status, local inline email validation, correction and confirmation passed on desktop/mobile; no save submitted');
      console.log(`Screenshots: ${output}`); return;
    }
    if (process.env.IMPORT_SUCCESS_ONLY === '1' || process.env.REVALUATION_SUCCESS_ONLY === '1') {
      const revaluationSuccess = process.env.REVALUATION_SUCCESS_ONLY === '1';
      for (const width of [1440, 900, 390]) for (const theme of ['light', 'dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await command('Page.navigate', { url: revaluationSuccess ? `${base}/verification/revaluation-success` : `${base}/verification/import-success?missing=${width === 390 ? 1 : 0}` });
        await until("!!document.querySelector('.import-success-mark.is-confirmed') && document.readyState==='complete' && typeof window.setThemePreference==='function'");
        await evaluate(`window.setThemePreference('${theme}')`); await pause(700);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.import-success-mark')).animationName"), 'import-confirm');
        assert.equal(await evaluate("document.querySelectorAll('.import-celebration span').length"), 96);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.import-celebration')).pointerEvents==='none' && getComputedStyle(document.querySelector('.import-celebration')).position==='fixed'"), true);
        assert.equal(await evaluate("Math.abs(document.querySelector('.import-celebration').getBoundingClientRect().left-Math.max(0,document.querySelector('.main-content').getBoundingClientRect().left))<2"), true);
        assert.equal(await evaluate("[...document.querySelectorAll('.import-celebration span')].some(piece=>Number(getComputedStyle(piece).opacity)>0)"), true);
        await evaluate("document.getElementById('replayImportCelebration').click()");
        assert.equal(await evaluate("document.querySelector('.import-success-header').getAnimations({subtree:true}).some(a=>a.animationName==='import-confetti'&&a.currentTime<500)"), true);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.import-success-header')).opacity"), '1');
        if (!revaluationSuccess) assert.equal(await evaluate("document.querySelectorAll('.import-success-actions a').length"), 2);
        else assert.equal(await evaluate("document.getElementById('revaluationSuccessTitle').textContent"), 'Revaluation processed successfully');
        await pause(900);
        await fs.writeFile(path.join(output, `${revaluationSuccess ? 'revaluation' : 'import'}-success-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        if (width === 1440 && theme === 'light') {
          await evaluate("document.getElementById('sidebarCollapseBtn').click()"); await pause(400);
          assert.equal(await evaluate("Math.abs(document.querySelector('.import-celebration').getBoundingClientRect().left-document.querySelector('.main-content').getBoundingClientRect().left)<2"), true);
          await evaluate("document.getElementById('sidebarCollapseBtn').click()"); await pause(400);
        }
      }
      await until("[...document.querySelectorAll('.import-celebration span')].every(piece=>Number(getComputedStyle(piece).opacity)===0)");
      await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await until("document.getElementById('replayImportCelebration').hidden");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.import-success-mark')).animationName"), 'none');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.import-success-header')).opacity"), '1');
      assert.equal(await evaluate("document.getElementById('replayImportCelebration').hidden"), true);
      if (revaluationSuccess) {
        await command('Page.navigate', { url: `${base}/verification/revaluation-success?status=pending` });
        await until("document.readyState==='complete' && !!document.querySelector('.revaluation-ui')");
        assert.equal(await evaluate("!!document.querySelector('.import-celebration')"), false);
      }
      assert.deepEqual(exceptions, []);
      console.log('Import success: saved metrics, missing CGPA, responsive light/dark layout, confirmation animation and reduced-motion passed; no result saved');
      console.log(`Screenshots: ${output}`); return;
    }
    if (process.env.SESSION_SUMMARY_ONLY === '1') {
      await command('Page.navigate', { url: `${base}/verification/exam-sessions` });
      await until("document.getElementById('currentSessionName')?.textContent==='Semester 1'");
      assert.equal(await evaluate("document.getElementById('currentSessionLabel').textContent"), 'Latest Session');
      assert.equal(await evaluate("document.getElementById('currentSessionStatus').textContent"), 'Completed');
      for (const width of [1440, 1280, 900, 390]) for (const theme of ['light', 'dark']) {
        await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await evaluate(`window.setThemePreference('${theme}')`); await pause(350);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, JSON.stringify(await evaluate("({width:innerWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='fixed').slice(0,8).map(e=>[e.tagName,e.className])})")));
        assert.equal(await evaluate("[...document.querySelectorAll('.sessions-summary .stat-card')].every(card=>card.scrollWidth<=card.clientWidth+1)"), true);
        assert.equal(await evaluate("new Set([...document.querySelectorAll('.sessions-summary .stat-card')].map(card=>Math.round(card.getBoundingClientRect().height))).size"), 1);
        assert.equal(await evaluate("new Set([...document.querySelectorAll('.sessions-summary .stat-card')].map(card=>Math.round(card.getBoundingClientRect().width))).size"), 1);
        assert.equal(await evaluate("[...document.querySelectorAll('.sessions-summary .stat-card')].every(card=>card.getBoundingClientRect().height<=100)"), true);
        assert.equal(await evaluate("!document.querySelector('.sessions-summary #currentSessionContext') && document.getElementById('currentSessionBatch').textContent==='MCA 2025'"), true);
        await fs.writeFile(path.join(output, `session-summary-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      }
      await evaluate("document.getElementById('currentSessionBatch').textContent='Master of Computer Applications Academic Batch 2025-2027';document.getElementById('currentSessionName').textContent='Semester 12'");
      assert.equal(await evaluate("[...document.querySelectorAll('.sessions-summary .stat-content')].every(content=>content.scrollWidth<=content.clientWidth+1)"), true);
      assert.deepEqual(exceptions, []);
      console.log('Session summary: structured details, equal card heights, desktop/tablet/mobile, light/dark and long labels passed; no data saved');
      console.log(`Screenshots: ${output}`); return;
    }
    if (process.env.REPORT_BATCH_DEFAULTS_ONLY === '1') {
      const batches = await service.getOptions('batches', {});
      assert.ok(batches.length, 'At least one batch is required for browser verification');
      const latest = String(batches[0].batch_id);
      for (const type of ['student', 'class', 'subject', 'revaluation', 'toppers', 'consolidated', 'result-analysis', 'student-progress']) {
        await command('Page.navigate', { url: `${base}/reports/${type}` });
        await until(`document.getElementById('report-batch_id')?.value===${JSON.stringify(latest)} && !document.getElementById('report-batch_id').disabled && document.getElementById('reports-filter-state').textContent!=='Loading filters...'`);
        assert.equal(await evaluate("document.getElementById('reports-error').hidden"), true);
        await choose('batch_id', '');
        await evaluate("document.getElementById('reports-filters').dispatchEvent(new Event('reset',{cancelable:true}))");
        await until(`document.getElementById('report-batch_id').value===${JSON.stringify(latest)} && document.getElementById('reports-filter-state').textContent!=='Loading filters...'`);
        if (type === 'class') {
          for (const width of [1440, 390]) {
            await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await pause(350);
            await fs.writeFile(path.join(output, `report-default-batch-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
          }
        }
        console.log(`${type}: latest batch selected on opening and Reset`);
      }
      assert.deepEqual(exceptions, []);
      console.log(`Screenshots: ${output}`); return;
    }
    if (process.env.ROSTER_LINK_ONLY === '1') {
      const models = require('../database/models');
      const courses = await models.AcademicCourse.findAll({ where: { roster_verified: true }, raw: true });
      const batches = await models.Batch.findAll({ raw: true });
      const selected = courses.find(course => Number(course.semester) <= require('../public/js/academic-form-options').semesterCount(batches.find(batch => String(batch.batch_id) === String(course.batch_id))));
      assert.ok(selected, 'A verified roster is required for the real edit-link check');
      await command('Page.navigate', { url: `${base}/subjects?tab=roster&batch_id=${selected.batch_id}&semester=${selected.semester}` });
      await until("!!document.getElementById('editRosterBtn') && document.readyState==='complete'");
      const target = await evaluate("(()=>{const b=document.getElementById('editRosterBtn');const r=b.getBoundingClientRect();return{href:b.href,x:r.x+r.width/2,y:r.y+r.height/2}})()");
      console.log('Edit link:', target.href);
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
      await until("document.querySelectorAll('[name=required_courses]').length>0 && document.readyState==='complete'");
      assert.equal(await evaluate("location.pathname"), '/subjects/roster/edit');
      assert.equal(await evaluate("new URLSearchParams(location.search).get('batch_id')"), String(selected.batch_id));
      assert.equal(await evaluate("new URLSearchParams(location.search).get('semester')"), String(selected.semester));
      await evaluate("document.querySelector('[name=required_courses]').checked=false;document.getElementById('reviewRosterBtn').click()");
      await until("document.getElementById('rosterReviewModal').classList.contains('show')"); await pause(400);
      await evaluate("document.getElementById('rosterAcknowledge').click()");
      assert.equal(await evaluate("document.getElementById('confirmRosterBtn').disabled"), false);
      await fs.writeFile(path.join(output, 'real-roster-edit-review.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      console.log('Real roster: actual Edit link, edit controls, review and acknowledgement passed; no save submitted');
      console.log(`Screenshots: ${output}`); return;
    }
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
    await command('Page.navigate', { url: `${base}/verification/exam-sessions` });
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
    await command('Page.navigate', { url: `${base}/verification/exam-sessions` });
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
    await pause(400);
    await evaluate("document.getElementById('createSubjectBtn').click()");
    await until("document.getElementById('subjectFormModal').classList.contains('show')"); await pause(400);
    await evaluate("document.getElementById('subjectCode').value='NEW';document.getElementById('subjectName').value='New Course';document.getElementById('subjectSaveBtn').click()");
    await until("document.getElementById('subjectConfirmModal').classList.contains('show')"); await pause(400);
    await evaluate("document.getElementById('subjectConfirmBtn').click()");
    await until("!!document.querySelector('#subjectsToastContainer .alert-link')");
    assert.equal(await evaluate("new URL(document.querySelector('#subjectsToastContainer .alert-link').href).searchParams.get('semester')"), '1');
    assert.equal(await evaluate("new URL(document.querySelector('#subjectsToastContainer .alert-link').href).searchParams.get('batch_id')"), '9001');
    await pause(6500);
    assert.equal(await evaluate("document.querySelector('#subjectsToastContainer .alert-link') === null"), true);
    console.log('Edit forms: split batch fields, year pickers, locked semester/month-year update, session summary and zero-credit/project subject confirmation passed (fixture saves only)');
    const batchResponse = await (await fetch(`${base}/batches?format=json`)).json();
    const latestBatch = require('../public/js/academic-form-options').sortBatches(batchResponse.data)[0];
    await command('Page.navigate', { url: `${base}/results/upload` });
    await until("document.readyState==='complete' && !!document.getElementById('uploadBatchSelect')");
    assert.equal(await evaluate("document.getElementById('uploadBatchSelect').value"), String(latestBatch.batch_id));
    assert.equal(await evaluate("[...document.getElementById('examSessionSelect').options].filter(o=>o.value).every(o=>o.dataset.batchId===document.getElementById('uploadBatchSelect').value)"), true);
    assert.equal(await evaluate("document.getElementById('extractButton').disabled"), true);
    for (const width of [1440, 390]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await pause(200);
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
      await fs.writeFile(path.join(output, `result-upload-batch-${width}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    const uploadSessions = (await (await fetch(`${base}/exam-sessions?format=json`)).json()).data;
    const uploadSession = uploadSessions.find(row => batchResponse.data.some(b => String(b.batch_id) === String(row.batch_id)));
    if (uploadSession) {
      await evaluate(`document.getElementById('uploadBatchSelect').value='${uploadSession.batch_id}';document.getElementById('uploadBatchSelect').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('examSessionSelect').value='${uploadSession.exam_session_id}';document.getElementById('examSessionSelect').dispatchEvent(new Event('change',{bubbles:true}))`);
      await until("document.getElementById('sessionDetailsCard').style.display==='block'");
      await evaluate("document.getElementById('uploadBatchSelect').value='';document.getElementById('uploadBatchSelect').dispatchEvent(new Event('change',{bubbles:true}))");
      assert.equal(await evaluate("document.getElementById('examSessionSelect').disabled && document.getElementById('sessionDetailsCard').style.display==='none' && document.getElementById('extractButton').disabled"), true);
    }
    emptyFacultyFixture = true;
    await command('Page.navigate', { url: `${base}/verification/faculty` });
    await until("!document.getElementById('facultyAvailabilityNotice')?.classList.contains('d-none') && document.getElementById('facultySessionSelect')?.options.length>1");
    await evaluate("document.getElementById('facultySessionSelect').value='9100';document.getElementById('facultySessionSelect').dispatchEvent(new Event('change',{bubbles:true}))");
    await until("!!document.querySelector('[data-edit-faculty=\"9201\"]')");
    assert.equal(await evaluate("document.querySelector('[data-edit-faculty=\"9201\"]').disabled && document.querySelector('[data-subject-row=\"9201\"] .faculty-count-value').textContent==='0' && document.querySelector('[data-subject-row=\"9201\"]').textContent.includes('Unassigned')"), true);
    await evaluate("document.getElementById('addAssignmentFacultyBtn').click()");
    await until("document.getElementById('addFacultyModal').classList.contains('show')");
    emptyFacultyFixture = false;
    await command('Page.navigate', { url: `${base}/verification/faculty` });
    await until("document.getElementById('facultySessionSelect')?.options.length>1 && !document.getElementById('facultySessionSelect').disabled");
    await evaluate("document.getElementById('facultySessionSelect').value='9100';document.getElementById('facultySessionSelect').dispatchEvent(new Event('change',{bubbles:true}))");
    await until("!!document.querySelector('[data-edit-faculty=\"9200\"]')");
    await evaluate("document.querySelector('[data-edit-faculty=\"9200\"]').click()");
    assert.equal(await evaluate("document.getElementById('facultyConfirmModal').classList.contains('show')"), false);
    await evaluate("document.querySelector('[data-faculty-count=\"9200\"]').value=5;document.querySelector('[data-faculty-count=\"9200\"]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-review-faculty=\"9200\"]').click()");
    assert.equal(await evaluate("document.querySelector('[data-faculty-count=\"9200\"]').value==='5' && document.querySelector('[data-faculty-count=\"9200\"]').classList.contains('is-invalid') && !document.getElementById('facultyConfirmModal').classList.contains('show')"), true);
    await evaluate("document.querySelector('[data-faculty-count=\"9200\"]').value=3;document.querySelector('[data-faculty-count=\"9200\"]').dispatchEvent(new Event('input',{bubbles:true}))");
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
    assert.equal(await evaluate("document.getElementById('facultyEmailInput') === null"), true);
    await evaluate("document.getElementById('facultyCodeInput').value='VERIFY';document.getElementById('facultyNameInput').value='Verification Faculty'");
    assert.equal(await evaluate("document.getElementById('facultyConfirmModal').classList.contains('show')"), false);
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}')`); await pause(150);
      assert.equal(await evaluate("document.getElementById('addFacultyModal').scrollWidth <= innerWidth + 1"), true);
      await fs.writeFile(path.join(output, `faculty-create-form-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await evaluate("document.querySelector('#addFacultyForm [type=submit]').click()");
    await until("document.getElementById('facultyConfirmModal').classList.contains('show')");
    assert.equal(await evaluate("!document.getElementById('facultyConfirmSummary').textContent.includes('Email:')"), true);
    console.log('Academic forms: latest batch defaults, 4/8 semesters, automatic status, MCA default and Add Faculty without email passed (no saves)');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    for (const width of [1440,390]) for (const theme of ['light','dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: `${base}/verification/roster?verified=1` });
      await until("!!document.getElementById('editRosterBtn') && document.readyState === 'complete'");
      await evaluate(`window.setThemePreference('${theme}')`); await pause(300);
      assert.equal(await evaluate("!document.querySelector('[name=required_courses]') && !document.querySelector('[name=confirm]')"), true);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
      await fs.writeFile(path.join(output, `roster-readonly-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await command('Page.navigate', { url: `${base}/verification/roster` });
    await until("!!document.getElementById('course-semester') && document.readyState === 'complete'");
    assert.equal(await evaluate("document.getElementById('course-semester').options.length"), 8);
    await command('Page.navigate', { url: `${base}/verification/roster?verified=1` });
    await until("!!document.getElementById('editRosterBtn') && document.readyState === 'complete'");
    assert.equal(await evaluate("!document.querySelector('[name=required_courses]') && !document.querySelector('[name=confirm]')"), true);
    await command('Page.navigate', { url: `${base}/verification/roster?verified=1&edit=1` });
    await until("!!document.getElementById('reviewRosterBtn') && document.readyState === 'complete'");
    await evaluate("document.querySelectorAll('[name=required_courses]').forEach(input=>input.checked=false);document.getElementById('reviewRosterBtn').click()");
    assert.equal(await evaluate("document.getElementById('rosterReviewError').textContent.includes('at least one')"), true);
    await evaluate("document.querySelector('[name=required_courses][value=\"9400\"]').checked=true;document.getElementById('reviewRosterBtn').click()");
    await until("document.getElementById('rosterReviewModal').classList.contains('show')"); await pause(400);
    assert.equal(await evaluate("document.getElementById('rosterReviewSummary').textContent.includes('Removed from required roster (1)') && document.getElementById('rosterReviewSummary').textContent.includes('EXTRA')"), true);
    await evaluate("document.querySelector('#rosterReviewModal [data-bs-dismiss=modal]').click()");
    await until("!document.getElementById('rosterReviewModal').classList.contains('show')"); await pause(400);
    assert.equal(await evaluate("!document.querySelector('[name=required_courses][value=\"9401\"]').checked && document.getElementById('rosterAcknowledge').disabled"), true);
    await evaluate("document.getElementById('reviewRosterBtn').click()");
    await until("document.getElementById('rosterReviewModal').classList.contains('show')"); await pause(400);
    const beforeReviewWrites = verificationWrites.length;
    await evaluate("document.getElementById('confirmRosterBtn').click()");
    assert.equal(verificationWrites.length, beforeReviewWrites);
    for (const width of [1440,390]) for (const theme of ['light','dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`window.setThemePreference('${theme}')`); await pause(300);
      assert.equal(await evaluate("document.getElementById('rosterReviewModal').scrollWidth <= innerWidth+1"), true);
      await fs.writeFile(path.join(output, `roster-correction-review-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await evaluate("document.getElementById('rosterAcknowledge').checked=true;document.getElementById('rosterAcknowledge').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('confirmRosterBtn').click()");
    await until("!!document.getElementById('editRosterBtn') && document.getElementById('rosterContent').textContent.includes('Not required')");
    assert.equal(await evaluate("!document.querySelector('[name=required_courses]') && !document.querySelector('[name=confirm]')"), true);
    const correctionWrite = verificationWrites.find(write=>write.path==='/subjects/roster');
    assert.equal(correctionWrite.body.confirm, '1'); assert.deepEqual([correctionWrite.body.required_courses].flat(), ['9400']);
    console.log('Roster correction: verified read-only view, explicit editing, empty selection guard, added/removed review, cancel, acknowledgement and corrected required selection passed; creation reminder expires after six seconds (fixture writes only)');
    await evaluate("document.getElementById('course-batch').value='9001';document.getElementById('course-batch').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('course-semester').options.length"), 4);
    assert.equal(await evaluate("document.getElementById('rosterContent').hidden && (!document.getElementById('confirmRosterBtn') || document.getElementById('confirmRosterBtn').disabled)"), true);
    await evaluate("document.getElementById('course-batch').value='9002';document.getElementById('course-batch').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('course-semester').options.length"), 8);
    if (process.env.ACADEMIC_FORMS_ONLY === '1') { assert.deepEqual(exceptions, []); console.log(`Screenshots: ${output}`); return; }
    const batches = await service.getOptions('batches');
    let scope;
    for (const batch of batches) {
      const semesters = await service.getOptions('semesters', { batch_id: String(batch.batch_id) });
      for (const semester of semesters) {
        const sessions = await service.getOptions('sessions', { batch_id: String(batch.batch_id), semester: semester.semester });
        for (const session of sessions) {
          const query = { batch_id: String(batch.batch_id), semester: semester.semester, exam_session_id: String(session.exam_session_id) };
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
        assert.equal(link.searchParams.has('exam_session_id'), false);
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
        await evaluate("document.getElementById('progress-scope').value='year:1';document.getElementById('progress-filters').requestSubmit()");
        await until("document.getElementById('progress-summary-heading').textContent === 'First Year Completion'");
        const year = await progressService.getProgress({ batch_id: scope.query.batch_id, academic_year: 1, mode: 'effective' });
        for (const key of ['withoutBacklog', 'withBacklog', 'uncleared', 'unknown']) assert.equal(Number(await evaluate(`document.getElementById('progress-${key}').textContent`)), year.summary[key]);
      }
      console.log(`${route}: responsive, themes, navigation and charts passed`);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    for (const page of ['students', 'toppers', 'failed', 'subjects', 'semesters', 'revaluation']) {
      const compatible = { ...scope.query, mode: 'effective' };
      if (page === 'semesters') delete compatible.exam_session_id;
      if (page === 'revaluation') delete compatible.mode;
      await command('Page.navigate', { url: `${base}/analytics/${page}?${new URLSearchParams(compatible)}` });
      await until(`document.getElementById('filter-batch')?.value === '${scope.query.batch_id}' && (!document.getElementById('filter-session') || document.getElementById('filter-session').value === '${scope.query.exam_session_id}')`);
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
        await until(`document.getElementById('report-student_id').value === '${identity.student_id}' && !document.getElementById('report-exam_session_id').disabled && !document.getElementById('reports-generate').disabled`);
        await pause(1200);
        assert.equal(await evaluate("document.getElementById('report-student_id').value"), String(identity.student_id));
        assert.equal(await evaluate("document.getElementById('reports-error').hidden"), true);
        assert.equal(await evaluate("document.getElementById('report-semester').value"), 'all');
        await evaluate("window.fetch=window._reportSearchFetch");
        await fs.writeFile(path.join(output, 'student-report-live-search.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        console.log('Student Result: partial USN/name, live options, single-match periods, ambiguity, clearing, empty state and stale-response protection passed');
        await choose('student_id', selectedStudent.student.student_id);
        await available('semester'); await available('exam_session_id');
        assert.equal(await evaluate("document.getElementById('report-semester').value"), 'all');
        assert.equal(await evaluate("document.getElementById('report-exam_session_id').value"), 'all');
        assert.equal(await evaluate("document.getElementById('report-attempt_no').disabled"), true);
        await until("!document.getElementById('reports-generate').disabled");
        await evaluate("document.getElementById('reports-generate').click()");
        await until("!document.getElementById('reports-output').hidden");
        const all = await service.getReport('student', { batch_id: scope.query.batch_id, student_id: String(selectedStudent.student.student_id), semester: 'all', exam_session_id: 'all' });
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
        await available('exam_session_id'); await choose('exam_session_id', scope.query.exam_session_id);
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
        assert.equal(await evaluate("document.getElementById('report-semester') === null && document.getElementById('report-exam_session_id') === null"), true);
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
      assert.equal(await evaluate(type === 'student-progress' ? "document.getElementById('reports-output').hidden && document.getElementById('reports-generate').disabled" : "document.getElementById('reports-output').hidden && document.getElementById('report-exam_session_id').disabled && document.getElementById('reports-generate').disabled"), true);
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
    const studentQuery = { batch_id: scope.query.batch_id, student_id: String(selectedStudent.student.student_id), semester: 'all', exam_session_id: 'all' };
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
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: `${base}/subjects/courses?batch_id=${scope.query.batch_id}&semester=${scope.query.semester}` });
      await until("!!document.querySelector('[data-roster-page]') && document.readyState === 'complete'");
      await evaluate(`window.setThemePreference('${theme}')`); await pause(300);
      assert.equal(await evaluate("location.pathname === '/subjects' && new URLSearchParams(location.search).get('tab') === 'roster'"), true);
      assert.equal(await evaluate("document.getElementById('editRosterBtn') ? !document.querySelector('input[name=required_courses]') && !document.querySelector('input[name=confirm]') : document.getElementById('rosterAcknowledge').required && document.getElementById('rosterAcknowledge').disabled"), true);
      assert.equal(await evaluate("document.getElementById('course-batch').value"), String(scope.query.batch_id));
      assert.equal(await evaluate("document.getElementById('course-semester').value"), String(scope.query.semester));
      assert.equal(await evaluate("document.getElementById('semester-roster-tab').getAttribute('aria-current')"), 'page');
      assert.equal(await evaluate("!document.getElementById('subjectSessionSelect')"), true);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
      await fs.writeFile(path.join(output, `semester-roster-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await evaluate("document.getElementById('examination-subjects-tab').click()");
      await until(`document.getElementById('subjectBatchSelect')?.value === '${scope.query.batch_id}' && !document.getElementById('subjectSessionSelect').disabled`);
      await evaluate(`document.getElementById('subjectSessionSelect').value='${scope.query.exam_session_id}';document.getElementById('subjectSessionSelect').dispatchEvent(new Event('change',{bubbles:true}))`);
      await until("document.querySelectorAll('#subjectsTableBody [data-edit-subject]').length > 0");
      assert.equal(await evaluate("document.getElementById('examination-subjects-tab').getAttribute('aria-current')"), 'page');
      assert.equal(await evaluate(`new URL(document.getElementById('semester-roster-tab').href).searchParams.get('semester') === '${scope.query.semester}'`), true);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
      await fs.writeFile(path.join(output, `examination-subjects-${width}-${theme}.png`), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await command('Page.navigate', { url: `${base}/subjects?tab=roster` });
    await until("!!document.getElementById('course-batch') && document.readyState === 'complete'");
    assert.equal(await evaluate("document.getElementById('course-batch').value"), String(latestBatch.batch_id));
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
    await until("document.getElementById('report-exam_session_id').value === '" + scope.query.exam_session_id + "'");
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
