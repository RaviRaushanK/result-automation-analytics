'use strict';
// Isolated render harness: real layout/assets, fixture identity, no database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const layouts = require('express-ejs-layouts');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views'));
  app.use(layouts); app.set('layout', 'layouts/main'); app.use(express.static(path.join(__dirname, '../public')));
  app.use((req, res, next) => {
    const role = req.query.role === 'admin' ? 'admin' : 'faculty';
    req.user = { role, username: 'faculty.fixture' };
    req.account = { faculty_name: 'Faculty member with a very long family name for layout verification', faculty_code: 'FACULTY-VERIFICATION-42' };
    res.locals.user = req.user; res.locals.flash = []; res.locals.breadcrumbItems = [];
    next();
  });
  app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  app.use((req, res) => res.render('layouts/main', {
    layout: false, title: 'Faculty sidebar verification',
    body: '<section class="workspace-page"><h1>Academic workspace</h1><p>Sidebar layout verification.</p></section>'
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'faculty-sidebar-browser-'));
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
    assert.ok(port, 'Headless Edge debugging endpoint is available');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const waiting = new Map(), exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      const pending = waiting.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Browser timeout: ' + method)); }, 20000);
      waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async expression => {
      for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100); }
      throw new Error('Browser condition timed out: ' + expression);
    };
    const screenshot = async name => {
      const shot = await command('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    const metrics = () => evaluate(`(() => {
      const sidebar = document.getElementById('sidebar'), nav = sidebar.querySelector('.sidebar-scrollable');
      const rect = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width }; };
      return { viewport:innerWidth, documentWidth:document.documentElement.scrollWidth, sidebar:rect(sidebar), main:rect(document.querySelector('main')),
        footer:rect(sidebar.querySelector('.sidebar-footer')), profileCount:sidebar.querySelectorAll('.faculty-sidebar-profile').length, nav:rect(nav), settings:rect(sidebar.querySelector('.sidebar-settings-link')),
        groups:[...sidebar.querySelectorAll('.collapse')].map(e => getComputedStyle(e).display),
        overflowLinks:[...sidebar.querySelectorAll('.sidebar-link')].filter(e => e.clientWidth && e.scrollWidth > e.clientWidth+1).map(e => e.innerText),
        footerVisible:(() => { const r=sidebar.querySelector('.sidebar-settings-link').getBoundingClientRect(); return !!document.elementFromPoint(r.left+10,r.top+10)?.closest('.sidebar-footer'); })()
      };
    })()`);
    await command('Page.enable'); await command('Runtime.enable');
    for (const width of [1440, 1024, 768, 375]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: origin + '/analytics/subjects' });
      await until("document.readyState==='complete' && !!window.bootstrap && !!document.querySelector('.faculty-sidebar')");
      await evaluate('localStorage.clear()');
      // Reinitialize at this viewport with no stored collapse preference.
      await command('Page.navigate', { url: origin + '/analytics/subjects' });
      await until("document.readyState==='complete' && !!window.bootstrap"); await pause(350);
      if (width === 375) {
        const hidden = await metrics(); assert.ok(hidden.sidebar.right <= 1); assert.equal(hidden.main.left, 0);
        await evaluate("document.getElementById('sidebarToggle').click()"); await pause(350);
        assert.equal(await evaluate("document.getElementById('sidebarToggle').getAttribute('aria-expanded')"), 'true');
      }
      if (width === 768) {
        const rail = await metrics(); assert.equal(Math.round(rail.sidebar.width), 72); assert.ok(rail.main.left >= rail.sidebar.right);
        await screenshot('faculty-768-collapsed');
        await evaluate("document.getElementById('sidebarCollapseBtn').click()"); await pause(350);
      }
      const state = await metrics();
      assert.ok(state.documentWidth <= width + 1, JSON.stringify(state));
      assert.ok(state.sidebar.left >= -1 && state.sidebar.right <= width, JSON.stringify(state));
      if (width >= 768) assert.ok(state.main.left >= state.sidebar.right - 1, JSON.stringify(state));
      assert.deepEqual(state.groups, ['block', 'none']); assert.deepEqual(state.overflowLinks, []);
      const sizes = await evaluate(`(() => {
        const main = document.querySelector('.sidebar-link[href="/dashboard"]'), sub = document.querySelector('.sidebar-link[href="/analytics/subjects"]');
        return { rootSize:parseFloat(getComputedStyle(document.documentElement).fontSize), subText:parseFloat(getComputedStyle(sub).fontSize), subPadding:getComputedStyle(sub).padding,
          mainIcon:getComputedStyle(main.querySelector('.material-icons')).fontSize, subIcon:getComputedStyle(sub.querySelector('.material-icons')).fontSize };
      })()`);
      assert.ok(Math.abs(sizes.subText - sizes.rootSize * .85) < .01); assert.equal(sizes.subPadding, '8px 12px'); assert.equal(sizes.mainIcon, sizes.subIcon);
      assert.ok(state.nav.bottom <= state.footer.top + 1); assert.ok(state.settings.bottom <= 900); assert.ok(state.footerVisible);
      assert.equal(state.profileCount, 0);
      await screenshot('faculty-' + width);
      // Reports begins closed and can be opened and closed manually.
      await evaluate("document.querySelector('[data-bs-target=\"#menu-reports\"]').click()"); await pause(400);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('menu-reports')).display"), 'block');
      assert.equal(await evaluate("document.querySelector('[data-bs-target=\"#menu-reports\"]').getAttribute('aria-expanded')"), 'true');
      await evaluate("document.querySelector('[data-bs-target=\"#menu-reports\"]').click()"); await pause(400);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('menu-reports')).display"), 'none');
      assert.equal(await evaluate("document.querySelector('[data-bs-target=\"#menu-reports\"]').getAttribute('aria-expanded')"), 'false');
      await evaluate("document.querySelector('[data-bs-target=\"#menu-reports\"]').click()"); await pause(400);
      await evaluate("document.querySelector('.sidebar-scrollable').scrollTop=10000; document.documentElement.setAttribute('data-theme','dark')");
      assert.ok((await metrics()).footerVisible); await screenshot('faculty-' + width + '-dark-scrolled');
      if (width === 375) {
        await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))"); await pause(350);
        assert.equal(await evaluate("document.getElementById('sidebarToggle').getAttribute('aria-expanded')"), 'false');
      }
      console.log(`Faculty ${width}px: only Analytics defaults open, original submenu labels/spacing/icons, Reports toggle, no horizontal overflow; light/dark passed`);
    }
    // Resize the live open mobile drawer without a reload; it must release its
    // backdrop and scroll lock when returning to a desktop layout.
    await evaluate("document.getElementById('sidebarToggle').click()"); await pause(350);
    await command('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(400);
    assert.equal(await evaluate("document.querySelector('.sidebar-overlay').classList.contains('active') || document.body.style.overflow === 'hidden'"), false);
    await command('Emulation.setDeviceMetricsOverride', { width: 768, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(400);
    if (!await evaluate("document.getElementById('sidebar').classList.contains('collapsed')")) {
      await evaluate("document.getElementById('sidebarCollapseBtn').click()"); await pause(350);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false }); await pause(400);
    await evaluate("document.getElementById('sidebarToggle').click()"); await pause(350);
    assert.equal(await evaluate("document.getElementById('sidebar').classList.contains('collapsed')"), false);
    await evaluate("document.querySelector('.sidebar-scrollable').scrollTop=10000");
    const compact = await metrics();
    assert.ok(compact.documentWidth <= 376); assert.ok(compact.footerVisible); assert.ok(compact.settings.bottom <= 600);
    await screenshot('faculty-375-short-scrolled');
    console.log('Live mobile/desktop/tablet resizing and short-screen scrolling passed');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('localStorage.clear()');
    await command('Page.navigate', { url: origin + '/dashboard?role=admin' });
    await until("document.readyState==='complete' && !!window.bootstrap"); await pause(350);
    assert.equal(await evaluate("!!document.querySelector('.faculty-sidebar,link[href*=\"faculty-sidebar.css\"]')"), false);
    assert.equal(await evaluate("document.querySelectorAll('.sidebar .collapse.show').length"), 0);
    await screenshot('admin-1440-unchanged');
    await evaluate("localStorage.setItem('sras-sidebar-collapsed','true')");
    for (const route of ['/analytics/subjects', '/analytics/progress', '/analytics/toppers', '/reports/class']) {
      await command('Page.navigate', { url: origin + route });
      await until("document.readyState==='complete' && !!window.bootstrap");
      assert.equal(await evaluate("document.querySelector('.sidebar [aria-current=\"page\"]').getAttribute('href')"), route);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('menu-reports')).display"), route.startsWith('/reports') ? 'block' : 'none');
    }
    assert.deepEqual(exceptions, []);
    console.log('Admin navigation retains collapsed groups and shared styling. Screenshots: ' + output);
  } finally {
    if (socket) socket.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
