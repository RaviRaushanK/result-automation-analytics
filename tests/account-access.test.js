'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../database/models');
const repository = require('../repositories/settingsRepository');
after(() => db.sequelize.close());

test('blocked accounts get a styled HTML page, JSON APIs retain 403, and return-to-login ends the old session', async () => {
  const express = require('express'), session = require('express-session'), layouts = require('express-ejs-layouts');
  const originalAccount = repository.account, originalFind = db.AdminUser.findOne;
  const account = { admin_id: 1, username: 'Private faculty username', role: 'faculty', status: 'inactive', password_hash: await bcrypt.hash('test-password', 4) };
  repository.account = async () => null;
  db.AdminUser.findOne = async () => account;
  let protectedCalls = 0;
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views')); app.set('layout', 'layouts/main'); app.use(layouts);
  app.use(express.urlencoded({ extended: false })); app.use(express.json());
  app.use(session({ secret: 'account-access-test-only-secret', resave: false, saveUninitialized: false }));
  app.use(require('../middlewares/userMiddleware')); app.use(require('../middlewares/themeMiddleware')); app.use(require('../middlewares/menuMiddleware'));
  app.get('/fixture/session', (req, res) => { req.session.adminId = 1; req.session.username = account.username; req.session.role = 'faculty'; res.json({ ok: true }); });
  app.get('/protected', require('../middlewares/authMiddleware'), (req, res) => { protectedCalls++; res.send('Private content'); });
  app.get('/account-fallback', require('../controllers/settingsController').currentAccount, (req, res) => res.send('Private content'));
  app.use(require('../routes/authRoutes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(origin + route, { redirect: 'manual', ...options });
  try {
    const created = await request('/fixture/session'); const cookie = created.headers.get('set-cookie').split(';')[0];
    for (const route of ['/protected', '/account-fallback']) {
      const response = await request(route, { headers: { Cookie: cookie, Accept: 'text/html' } });
      assert.equal(response.status, 403); assert.match(response.headers.get('cache-control'), /no-store/);
      const html = await response.text();
      assert.match(html, /account-access\.css/); assert.match(html, /Your access is currently disabled/);
      assert.match(html, /contact your institution administrator/); assert.match(html, /href="\/logout\?next=login"/);
      assert.doesNotMatch(html, /Private faculty username|class="sidebar|class="main-content|Private content/);
    }
    const api = await request('/protected', { headers: { Cookie: cookie, Accept: 'application/json' } });
    assert.equal(api.status, 403); assert.match(api.headers.get('content-type'), /application\/json/);
    const json = await api.json(); assert.equal(json.code, 'ACCOUNT_ACCESS_DISABLED'); assert.match(json.error, /institution administrator/);
    assert.equal(protectedCalls, 0);
    for (const status of ['inactive', 'active']) {
      account.status = status;
      const login = await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/html' }, body: JSON.stringify({ username: account.username, password: 'test-password' }) });
      assert.equal(login.status, 403); const html = await login.text();
      assert.match(html, /Your access is currently disabled/); assert.match(html, /href="\/login"/);
    }
    const wrongPassword = await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account.username, password: 'wrong-password' }) });
    assert.match(await wrongPassword.text(), /Invalid username or password/);
    const logout = await request('/logout?next=login', { headers: { Cookie: cookie } });
    assert.equal(logout.status, 302); assert.equal(logout.headers.get('location'), '/login');
    const signIn = await request('/login', { headers: { Cookie: cookie } });
    assert.equal(signIn.status, 200); assert.match(await signIn.text(), /Welcome back/);
    for (const route of ['/logout', '/logout?next=https://example.com']) assert.equal((await request(route)).headers.get('location'), '/');
  } finally { await new Promise(resolve => server.close(resolve)); repository.account = originalAccount; db.AdminUser.findOne = originalFind; }
});
