'use strict';
// Real Faculty page and status routes; all writes use in-memory fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const layouts = require('express-ejs-layouts');
const db = require('../database/models');
const accounts = require('../repositories/settingsRepository');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const writes = [], rows = [
    { faculty_id: 10, faculty_name: 'Faculty "Quote" <script>window.injected=1</script>', faculty_code: 'FAC10', status: 'active', deleted_at: null },
    { faculty_id: 11, faculty_name: 'Former Faculty', faculty_code: 'FAC11', status: 'inactive', deleted_at: null },
  ];
  const saved = { account: accounts.account, all: db.Faculty.findAll, find: db.Faculty.findOne, actor: db.AdminUser.findOne, transaction: db.sequelize.transaction };
  accounts.account = async () => ({ admin_id: 1, username: 'Status verification', role: 'admin', status: 'active' });
  db.AdminUser.findOne = async () => ({ admin_id: 1 });
  db.Faculty.findAll = async options => rows.filter(row => !options.where.status || row.status === options.where.status).map(row => ({ ...row }));
  db.Faculty.findOne = async options => {
    const row = rows.find(item => String(item.faculty_id) === String(options.where.faculty_id));
    return row && { ...row, update: async values => { Object.assign(row, values); writes.push(values.status); } };
  };
  db.sequelize.transaction = async callback => callback({ LOCK: { UPDATE: 'UPDATE' } });
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views')); app.set('layout', 'layouts/main'); app.use(layouts);
  app.use(express.static(path.join(__dirname, '../public'))); app.use(express.json());
  app.use((req, res, next) => { req.session = { adminId: 1, role: 'admin', username: 'Status verification', csrfToken: 'b'.repeat(64) }; res.locals.flash = []; res.locals.breadcrumbItems = []; next(); });
  app.use(require('../middlewares/userMiddleware')); app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  app.get('/batches', (req, res) => res.json({ data: [] }));
  app.use('/faculty', require('../middlewares/authMiddleware'), require('../middlewares/adminMiddleware'), require('../routes/facultyRoutes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'faculty-status-browser-'));
  const browser = spawn(process.env.REPORTS_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${output}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let socket, browserError;
  browser.on('error', error => { browserError = error; });
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      if (browserError) throw browserError;
      try { port = Number((await fs.readFile(path.join(output, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
      if (port) break; await pause(100);
    }
    assert.ok(port, 'Edge debugger is available');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0; const waiting = new Map(), exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      const pending = waiting.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); waiting.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(new Error('Browser timeout: ' + method)); }, 20000);
      waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value;
    };
    const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error('Browser condition timed out: ' + expression); };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const act = () => evaluate("document.querySelector('[data-faculty-status-id=\"10\"]').click()");
    const screenshot = async name => { const shot = await command('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64')); };
    await command('Page.enable'); await command('Runtime.enable');
    for (const width of [1440, 1024, 768, 375]) for (const theme of ['light', 'dark']) {
      rows[0].status = 'active';
      await command('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: origin + '/faculty' });
      await until("document.readyState==='complete' && !!window.bootstrap && document.getElementById('facultyBatchSelect').disabled");
      await evaluate(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`);
      await click('manageFacultyBtn');
      await until("document.querySelectorAll('#facultyRegistryRows tr').length===2 && document.querySelector('#facultyRegistryModal.show')"); await pause(350);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'), true, width + ' page overflow');
      assert.equal(await evaluate("document.querySelectorAll('#facultyRegistryRows [onmouseover],#facultyRegistryRows script').length"), 0);
      assert.equal(await evaluate('window.injected'), undefined);
      assert.equal(await evaluate("document.querySelectorAll('#facultyRegistryRows .badge').length"), 2);
      await evaluate("document.getElementById('facultyRegistryFilter').value='inactive'; document.getElementById('facultyRegistryFilter').dispatchEvent(new Event('change'))");
      assert.equal(await evaluate("document.querySelectorAll('#facultyRegistryRows tr').length"), 1);
      await evaluate("document.getElementById('facultyRegistryFilter').value='all'; document.getElementById('facultyRegistryFilter').dispatchEvent(new Event('change')); document.getElementById('facultyRegistrySearch').value='FAC10'; document.getElementById('facultyRegistrySearch').dispatchEvent(new Event('input'))");
      assert.equal(await evaluate("document.querySelectorAll('#facultyRegistryRows tr').length"), 1);
      const count = writes.length;
      await act(); assert.equal(await evaluate("document.getElementById('facultyRegistryTitle').textContent"), 'Deactivate faculty?');
      await screenshot(`confirm-${width}-${theme}`);
      await click('facultyStatusCancelBtn'); assert.equal(writes.length, count);
      await act(); await evaluate("document.getElementById('facultyStatusConfirmBtn').click();document.getElementById('facultyStatusConfirmBtn').click()");
      await until("document.querySelector('[data-faculty-status-id=\"10\"]').textContent==='Activate'");
      assert.equal(writes.length, count + 1); assert.equal(rows[0].status, 'inactive');
      assert.match(await evaluate("document.getElementById('facultyRegistryNotice').textContent"), /deactivated/);
      await act(); assert.equal(await evaluate("document.getElementById('facultyRegistryTitle').textContent"), 'Activate faculty?');
      await click('facultyStatusConfirmBtn'); await until("document.querySelector('[data-faculty-status-id=\"10\"]').textContent==='Deactivate'");
      assert.equal(rows[0].status, 'active');
      const fits = await evaluate(`(() => { const modal=document.querySelector('#facultyRegistryModal .modal-content'),footer=modal.querySelector('.modal-footer'); const r=modal.getBoundingClientRect(),f=footer.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,footer:f.bottom,width:innerWidth,height:innerHeight}; })()`);
      assert.ok(fits.left >= 0 && fits.right <= width + 1 && fits.top >= 0 && fits.footer <= 801, JSON.stringify(fits));
      await screenshot(`registry-${width}-${theme}`);
      console.log(`Faculty status ${width}px ${theme}: filter/search, confirmation/cancel, activate/deactivate, duplicate-click protection and modal layout passed`);
    }
    // Another administrator changed this record while confirmation was open.
    await act(); rows[0].status = 'inactive'; await click('facultyStatusConfirmBtn');
    await until("document.getElementById('facultyRegistryError').textContent.includes('status has changed')");
    assert.equal(await evaluate("document.querySelector('[data-faculty-status-id=\"10\"]').textContent"), 'Activate');
    assert.deepEqual(exceptions, []);
    console.log('Stale status conflict refresh passed. Screenshots: ' + output);
  } finally {
    if (socket) socket.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
    accounts.account = saved.account; db.Faculty.findAll = saved.all; db.Faculty.findOne = saved.find; db.AdminUser.findOne = saved.actor; db.sequelize.transaction = saved.transaction;
    await db.sequelize.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
