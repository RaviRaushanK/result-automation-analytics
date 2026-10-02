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
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { adminId: 1, username: 'Report verification', role: 'faculty' };
    res.locals.flash = []; res.locals.breadcrumbItems = [];
    next();
  });
  app.use(require('../middlewares/userMiddleware'));
  app.use(require('../middlewares/themeMiddleware'));
  app.use(require('../middlewares/menuMiddleware'));
  app.use('/reports', require('../routes/reportsRoutes'));
  app.use('/students', require('../routes/studentsRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'sraas-reports-browser-'));
  const browserPath = process.env.REPORTS_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${output}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let browserError;
  browser.on('error', err => { browserError = err; });
  let socket;
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
          if (subjects.length && report.pagination.totalRows > 25) { scope = { query, subjects, totalRows: report.pagination.totalRows }; break; }
        }
        if (scope) break;
      }
      if (scope) break;
    }
    if (!scope) throw new Error('Browser verification needs a session with subjects and more than 25 result attempts.');
    const students = await service.getOptions('students', scope.query);
    let selectedStudent;
    for (const student of students) {
      const attempts = await service.getOptions('student-results', { ...scope.query, student_id: String(student.student_id) });
      if (attempts.length) { selectedStudent = { student, attempts }; break; }
    }

    for (const type of service.TYPES) {
      await command('Page.navigate', { url: `${base}/reports/${type}` });
      await available('batch_id');
      await choose('batch_id', scope.query.batch_id);
      if (type === 'student') {
        await available('student_id');
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
        assert.equal(await evaluate("document.querySelectorAll('#reports-table tbody tr').length"), 25);
        await evaluate("document.getElementById('reports-next').click()");
        await until("!document.getElementById('reports-loading').hidden === false && document.getElementById('reports-page-info').textContent.startsWith('Page 2')");
        assert.equal(await evaluate("document.querySelector('#reports-table tbody td').textContent"), '26');
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
    await command('Page.navigate', { url: `${base}/students?batch_id=${scope.query.batch_id}` });
    await until("document.querySelector('[data-category]') !== null");
    assert.equal(await evaluate("document.querySelectorAll('[data-category]').length"), 25);
    await evaluate(`(() => {
      window.fetch = async (url, options) => {
        window.categorySave = { url, method: options.method, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ success: true, student: { category: 'PGCET' } }) };
      };
      document.querySelector('[data-category]').value = 'PGCET';
      document.querySelector('[data-save-category]').click();
    })()`);
    await until("!document.getElementById('students-category-message').hidden");
    assert.equal(await evaluate('window.categorySave.method'), 'PATCH');
    assert.equal(await evaluate('window.categorySave.body.category'), 'PGCET');
    assert.equal(await evaluate('window.categorySave.body.batch_id'), scope.query.batch_id);
    assert.equal(await evaluate("document.querySelector('[data-save-category]').disabled"), false);
    await fs.writeFile(path.join(output, 'student-categories-desktop.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.documentElement.setAttribute('data-theme','dark')");
    await pause(350);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    await fs.writeFile(path.join(output, 'student-categories-mobile-dark.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log('student categories: paginated page, save interaction and mobile theme passed (no database writes)');
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
    const consolidatedPdf = await command('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(path.join(output, 'consolidated-full-print.pdf'), Buffer.from(consolidatedPdf.data, 'base64'));
    await command('Emulation.setEmulatedMedia', { media: 'print' });
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
    assert.deepEqual(exceptions, []);
    console.log(`Screenshots: ${output}`);
  } finally {
    socket?.close();
    browser.kill();
    await new Promise(resolve => server.close(resolve));
    await sequelize.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
