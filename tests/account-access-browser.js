'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const layouts = require('express-ejs-layouts');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views')); app.use(layouts);
  app.use(express.static(path.join(__dirname, '../public'))); app.use(require('../middlewares/themeMiddleware'));
  app.use((req, res) => { req.session = { adminId: 1 }; return require('../middlewares/accountAccessResponse')(req, res); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'account-access-browser-'));
  const browser = spawn(process.env.REPORTS_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${output}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket, browserError;
  browser.on('error', error => { browserError = error; });
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      if (browserError) throw browserError;
      try { port = Number((await fs.readFile(path.join(output, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
      if (port) break; await pause(100);
    }
    assert.ok(port, 'Headless Edge debugger is available');
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
    const until = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error('Browser condition timed out: ' + expression); };
    function contrast(a, b) {
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
    }
    await command('Page.enable'); await command('Runtime.enable');
    for (const width of [1440, 1024, 768, 375]) for (const theme of ['light', 'dark']) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 667 : 900, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: origin });
      await until("document.readyState==='complete' && !!document.getElementById('account-access-title')");
      await evaluate(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`); await pause(200);
      const state = await evaluate(`(() => {
        const card=document.querySelector('.account-access-card'), r=card.getBoundingClientRect(), heading=document.querySelector('h1'), description=document.querySelector('.account-access-description'), guidance=document.querySelector('.account-access-guidance p');
        return { width:innerWidth, documentWidth:document.documentElement.scrollWidth, left:r.left, right:r.right, top:r.top,
          background:getComputedStyle(card).backgroundColor,heading:getComputedStyle(heading).color,description:getComputedStyle(description).color,
          guidance:getComputedStyle(guidance).color,guidanceBackground:getComputedStyle(guidance.parentElement).backgroundColor,
          buttonText:getComputedStyle(card.querySelector('.btn-primary')).color, buttonBackground:getComputedStyle(card.querySelector('.btn-primary')).backgroundColor,
          links:[...card.querySelectorAll('a')].map(a=>a.getAttribute('href')), workspace:!!document.querySelector('.sidebar,.main-content') };
      })()`);
      assert.ok(state.documentWidth <= width + 1 && state.left >= 0 && state.right <= width + 1 && state.top >= 0, JSON.stringify(state));
      assert.ok(contrast(state.heading, state.background) >= 4.5); assert.ok(contrast(state.description, state.background) >= 4.5); assert.ok(contrast(state.guidance, state.guidanceBackground) >= 4.5);
      assert.ok(contrast(state.buttonText, state.buttonBackground) >= 4.5);
      assert.ok(state.links.includes('/logout?next=login')); assert.equal(state.workspace, false);
      const shot = await command('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, `access-${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`Account access ${width}px ${theme}: card layout, no overflow, readable contrast and safe sign-in link passed`);
    }
    assert.deepEqual(exceptions, []); console.log('Screenshots: ' + output);
  } finally { if (socket) socket.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
